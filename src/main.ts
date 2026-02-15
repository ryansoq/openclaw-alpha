import { createScene } from "./scene/room.js";
import { LobsterManager } from "./scene/lobster-manager.js";
import { EffectsManager } from "./scene/effects.js";
import { createBuildings } from "./scene/buildings.js";
import { WSClient } from "./net/ws-client.js";
import { setupOverlay } from "./ui/overlay.js";
import { setupChatLog } from "./ui/chat-log.js";
import { setupProfilePanel } from "./ui/profile-panel.js";
import { setupBuildingPanel } from "./ui/building-panel.js";
import { setupRoomInfoBar } from "./ui/room-info-bar.js";
import { setupTelegramLogin } from "./ui/telegram-login.js";
import { initTaskBoard, handleTaskBoardMessage } from "./ui/task-board.js";
import { setupPRBoard } from "./ui/pr-board.js";
import { setupAgentChat } from "./ui/agent-chat.js";
import { initDashboard, handleDashboardUpdate } from "./ui/dashboard.js";
import { initScreenDisplay, handleScreenUpdate } from "./ui/screen-display.js";
import type { DashboardAPI } from "./ui/dashboard.js";
import type { ScreenDisplayAPI } from "./ui/screen-display.js";
import * as THREE from "three";
import type { AgentProfile, AgentState, WorldMessage, RoomInfoMessage } from "../server/types.js";

// ── Agent name registry (agentId → displayName) ──────────────
const agentNames = new Map<string, string>();
function nameOf(agentId: string): string { return agentNames.get(agentId) || agentId; }

// ── Parse URL params ───────────────────────────────────────────

const params = new URLSearchParams(window.location.search);
const focusAgent = params.get("agent");
const serverParam = params.get("server");

// ── Global server base URL (for API calls from building panels etc.) ──

/** Empty string for local (Vite proxy), or full URL for remote */
export let serverBaseUrl = serverParam || "";

// ── Scene setup (immediate — no lobby) ────────────────────────

const { scene, camera, renderer, labelRenderer, controls, clock, obstacles } = createScene();

// Add buildings (Moltbook + Clawhub) to the scene
const { buildings, obstacles: buildingObstacles } = createBuildings(scene);
const allObstacles = [...obstacles, ...buildingObstacles];

const lobsterManager = new LobsterManager(scene, allObstacles);
const effects = new EffectsManager(scene, camera);
const buildingPanel = setupBuildingPanel(serverParam);
const prBoard = setupPRBoard(serverBaseUrl || window.location.origin);
const agentChat = setupAgentChat(serverBaseUrl || window.location.origin);
const roomInfoBar = setupRoomInfoBar();

// Proximity greetings: show emote when agents meet
const greetingEmojis = ["👋", "😊", "🙌", "✨", "🤝"];
lobsterManager.setGreetingCallback((agentA, agentB) => {
  const emoji = greetingEmojis[Math.floor(Math.random() * greetingEmojis.length)];
  effects.showEmote(agentA, emoji);
  effects.showEmote(agentB, emoji);
});

// ── UI ─────────────────────────────────────────────────────────

const overlay = setupOverlay();
const chatLog = setupChatLog();

// ── Telegram Login ─────────────────────────────────────────────

setupTelegramLogin(roomInfoBar.getElement(), (auth) => {
  chatLog.addSystem(`${auth.name} logged in`);
  // Show chat input after login
  chatLog.showInput(async (text) => {
    const apiUrl = serverBaseUrl ? `${serverBaseUrl}/ipc` : "/ipc";
    await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        command: "world-chat",
        token: auth.token,
        args: { agentId: auth.agentId, text },
      }),
    });
  });
});

const profilePanel = setupProfilePanel((agentId: string) => {
  // Click callback → focus camera on lobster
  const pos = lobsterManager.getPosition(agentId);
  if (pos) {
    controls.target.set(pos.x, pos.y + 2, pos.z);
  }
});

// Wire up "Send Message" button in profile panel → open chat overlay
profilePanel.onSendMessage((targetProfile) => {
  // Use the focused agent or default "anonymous" as sender
  const myId = focusAgent || "anonymous";
  profilePanel.hide();
  agentChat.open(myId, targetProfile);
});

// ── WebSocket connection ───────────────────────────────────────

const ws = new WSClient(serverParam || undefined);

// Bridge connection events to window for overlay status dot
let profileRefreshInterval: ReturnType<typeof setInterval> | null = null;

ws.on("connected", async () => {
  window.dispatchEvent(new CustomEvent("ws:connected"));
  // Request full (non-AOI-filtered) profiles for the overlay agent list
  ws.requestProfiles();
  // Periodically refresh agent list (every 30s) to catch joins/leaves
  if (profileRefreshInterval) clearInterval(profileRefreshInterval);
  profileRefreshInterval = setInterval(() => ws.requestProfiles(), 30_000);
  
  // Pre-load agent profiles for name mapping
  try {
    const pUrl = serverBaseUrl ? `${serverBaseUrl}/ipc` : "/ipc";
    const pResp = await fetch(pUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "profiles" }),
    });
    const pData = await pResp.json();
    if (pData.profiles) {
      for (const p of pData.profiles) agentNames.set(p.agentId, p.name);
    }
  } catch (_) { /* ignore */ }

  // Load chat history on connect
  try {
    const apiUrl = serverBaseUrl ? `${serverBaseUrl}/ipc` : "/ipc";
    const resp = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "room-events", args: { limit: 50 } }),
    });
    const data = await resp.json();
    if (data.ok && data.events) {
      // Show historical chat messages
      // First pass: build name map from join/chat events
      for (const evt of data.events) {
        if (evt.name) {
          agentNames.set(evt.agentId, evt.name);
        }
      }
      // Second pass: render chat messages with display names
      for (const evt of data.events) {
        if (evt.worldType === "chat") {
          chatLog.addMessage(evt.agentId, evt.text, evt.timestamp, nameOf(evt.agentId));
        }
      }
    }
  } catch (e) {
    console.warn("[main] Failed to load chat history:", e);
  }
});
ws.on("disconnected", () => {
  window.dispatchEvent(new CustomEvent("ws:disconnected"));
  if (profileRefreshInterval) {
    clearInterval(profileRefreshInterval);
    profileRefreshInterval = null;
  }
});

ws.on("snapshot", (_raw) => {
  const data = _raw as { agents: AgentState[] };
  for (const agent of data.agents) {
    lobsterManager.addOrUpdate(agent.profile, agent.position);
    effects.updateLabel(agent.profile.agentId, agent.profile.name, agent.profile.color);
    agentNames.set(agent.profile.agentId, agent.profile.name);
  }
  // Note: overlay agent list is updated via requestProfiles + join/leave,
  // NOT from snapshots (which are AOI-filtered and would hide distant agents).

  // Auto-focus in preview mode
  if (focusAgent) {
    const pos = lobsterManager.getPosition(focusAgent);
    if (pos) {
      controls.target.set(pos.x, pos.y + 2, pos.z);
      camera.position.set(pos.x + 10, pos.y + 8, pos.z + 10);
    }
  }
});

ws.on("world", (_raw) => {
  const data = _raw as { message: WorldMessage };
  const msg = data.message;

  switch (msg.worldType) {
    case "position":
      lobsterManager.updatePosition(msg.agentId, msg);
      break;

    case "action":
      lobsterManager.setAction(msg.agentId, msg.action);
      break;

    case "join":
      lobsterManager.addOrUpdate(
        {
          agentId: msg.agentId,
          name: msg.name,
          color: msg.color,
          bio: msg.bio,
          capabilities: msg.capabilities,
          pubkey: "",
          joinedAt: msg.timestamp,
          lastSeen: msg.timestamp,
        },
        { agentId: msg.agentId, x: 0, y: 0, z: 0, rotation: 0, timestamp: msg.timestamp }
      );
      effects.updateLabel(msg.agentId, msg.name, msg.color);
      agentNames.set(msg.agentId, msg.name);
      chatLog.addSystem(`${msg.name} joined the office`);
      overlay.addAgent({
        agentId: msg.agentId,
        name: msg.name,
        pubkey: "",
        bio: msg.bio,
        capabilities: msg.capabilities,
        color: msg.color,
        joinedAt: msg.timestamp,
        lastSeen: msg.timestamp,
      });
      break;

    case "leave":
      lobsterManager.remove(msg.agentId);
      effects.removeLabel(msg.agentId);
      effects.removeBubble(msg.agentId);
      chatLog.addSystem(`${nameOf(msg.agentId)} left`);
      overlay.removeAgent(msg.agentId);
      break;

    case "chat":
      if ((msg as any).name) agentNames.set(msg.agentId, (msg as any).name);
      effects.showBubble(msg.agentId, msg.text);
      chatLog.addMessage(msg.agentId, msg.text, undefined, nameOf(msg.agentId));
      break;

    case "emote":
      effects.showEmote(msg.agentId, msg.emote);
      break;

    case "profile":
      effects.updateLabel(msg.agentId, msg.name, msg.color);
      overlay.updateAgent({
        agentId: msg.agentId,
        name: msg.name,
        bio: msg.bio,
        capabilities: msg.capabilities,
        color: msg.color,
        pubkey: "",
        joinedAt: 0,
        lastSeen: Date.now(),
      });
      break;
  }
});

ws.on("profiles", (_raw) => {
  const data = _raw as { profiles: AgentProfile[] };
  for (const p of data.profiles) agentNames.set(p.agentId, p.name);
  overlay.updateAgentList(data.profiles);
});

// Handle room info from server
ws.on("roomInfo", (_raw) => {
  const data = _raw as { info: RoomInfoMessage };
  roomInfoBar.update(data.info);
});

ws.on("task-board", (_raw) => {
  const data = _raw as { entries: any[] };
  handleTaskBoardMessage(data.entries);
});

ws.on("board-update", (_raw) => {
  const msg = _raw as { type: string; data: { entries: any[] } };
  handleDashboardUpdate(msg.data);
});

ws.on("screen-update", (_raw) => {
  const msg = _raw as { type: string; data: { screens: any[] } };
  handleScreenUpdate(msg.data);
});

ws.connect();

// Load initial task board data
initTaskBoard(serverBaseUrl || window.location.origin);

// Init dashboard and screen displays (overlay mode — no scene needed)
const dashboard: DashboardAPI = initDashboard(serverBaseUrl || window.location.origin, () => prBoard.show());
const screenDisplay: ScreenDisplayAPI = initScreenDisplay(serverBaseUrl || window.location.origin);

// ── Whiteboard click: show dashboard with "View PRs" toggle ────

function showWhiteboardPanel(): void {
  // Show dashboard overlay; it has a "View PRs" button built in
  dashboard.show();
}

// ── Click to select lobster or building ────────────────────────

const pickRaycaster = new THREE.Raycaster();
const pickPointer = new THREE.Vector2();

// Prevent right-click context menu (WoW-style camera rotation)
renderer.domElement.addEventListener("contextmenu", (e) => e.preventDefault());

renderer.domElement.addEventListener("click", (event: MouseEvent) => {
  // Don't process clicks when building panel is open
  if (buildingPanel.isVisible()) return;

  // First check for building clicks
  const rect = renderer.domElement.getBoundingClientRect();
  pickPointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pickPointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  pickRaycaster.setFromCamera(pickPointer, camera);

  // Collect building meshes
  const buildingMeshes: THREE.Mesh[] = [];
  for (const b of buildings) {
    b.mesh.traverse((child) => {
      if (child instanceof THREE.Mesh) buildingMeshes.push(child);
    });
  }
  const buildingHits = pickRaycaster.intersectObjects(buildingMeshes, false);
  if (buildingHits.length > 0) {
    let obj: THREE.Object3D | null = buildingHits[0].object;
    while (obj) {
      if (obj.userData.buildingId === "moltbook") {
        buildingPanel.showMoltbook();
        return;
      }
      if (obj.userData.buildingId === "clawhub") {
        buildingPanel.showClawhub();
        return;
      }
      if (obj.userData.buildingId === "worlds-portal") {
        buildingPanel.showWorlds();
        return;
      }
      if (obj.userData.buildingId === "whiteboard") {
        showWhiteboardPanel();
        return;
      }
      if (obj.userData.buildingId && String(obj.userData.buildingId).includes("desk")) {
        screenDisplay.showForDesk(obj.userData.buildingId);
        return;
      }
      obj = obj.parent;
    }
  }

  // Then check for lobster clicks
  const agentId = lobsterManager.pick(event, camera, renderer.domElement);
  if (agentId) {
    const profile = overlay.getAgent(agentId);
    if (profile) {
      profilePanel.show(profile);
      const pos = lobsterManager.getPosition(agentId);
      if (pos) {
        controls.target.set(pos.x, pos.y + 2, pos.z);
      }
    }
  }
});

// ── Camera follow ─────────────────────────────────────────────

let followAgentId: string | null = focusAgent;

window.addEventListener("agent:select", ((e: CustomEvent<{ agentId: string }>) => {
  const agentId = e.detail.agentId;
  if (followAgentId === agentId) {
    // Click again to unfollow
    followAgentId = null;
  } else {
    followAgentId = agentId;
    // Snap camera to agent immediately
    const pos = lobsterManager.getPosition(agentId);
    if (pos) {
      controls.target.set(pos.x, pos.y + 2, pos.z);
    }
  }
}) as EventListener);

// Clicking on the 3D scene (not on an agent) unfollows
renderer.domElement.addEventListener("dblclick", () => {
  followAgentId = null;
});

// ── Animation loop ─────────────────────────────────────────────

let viewportReportTimer = 0;
const VIEWPORT_REPORT_INTERVAL = 1.0; // seconds

// ── Toolbar events (from overlay toolbar) ──────────────────────
let render3D = true;

window.addEventListener("toolbar:toggle3d", () => {
  render3D = !render3D;
  renderer.domElement.style.display = render3D ? "" : "none";
  labelRenderer.domElement.style.display = render3D ? "" : "none";
});

window.addEventListener("toolbar:zoom", ((e: CustomEvent) => {
  const dir = e.detail?.dir;
  const factor = dir === "in" ? 0.8 : 1.25;
  // Move camera closer/farther from target
  const offset = camera.position.clone().sub(controls.target);
  offset.multiplyScalar(factor);
  camera.position.copy(controls.target).add(offset);
  controls.update();
}) as EventListener);

function animate() {
  requestAnimationFrame(animate);
  if (!render3D) return; // Skip rendering when 3D is off

  const delta = clock.getDelta();

  lobsterManager.update(delta);
  effects.update(camera);

  // Follow agent: smoothly track their position
  if (followAgentId) {
    const pos = lobsterManager.getPosition(followAgentId);
    if (pos) {
      const target = controls.target;
      target.lerp(new THREE.Vector3(pos.x, pos.y + 2, pos.z), 0.08);
    }
  }

  if ((controls as any)._keyPan) (controls as any)._keyPan();
  controls.update();

  // Report camera position to server for AOI filtering (every 1s)
  viewportReportTimer += delta;
  if (viewportReportTimer >= VIEWPORT_REPORT_INTERVAL) {
    viewportReportTimer = 0;
    const target = controls.target;
    ws.reportViewport(target.x, target.z);
  }

  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}

animate();

// ── Resize handler ─────────────────────────────────────────────

window.addEventListener("resize", () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  labelRenderer.setSize(w, h);
});
