process.on("uncaughtException", (err) => { console.error("[FATAL] uncaughtException:", err); });
process.on("unhandledRejection", (err) => { console.error("[FATAL] unhandledRejection:", err); });

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { AgentRegistry } from "./agent-registry.js";
import { WorldState } from "./world-state.js";
import { NostrWorld } from "./nostr-world.js";
import { WSBridge } from "./ws-bridge.js";
import { ClawhubStore } from "./clawhub-store.js";
import { SpatialGrid } from "./spatial-index.js";
import { CommandQueue } from "./command-queue.js";
import { ClientManager } from "./client-manager.js";
import { GameLoop, TICK_RATE } from "./game-loop.js";
import { EventStore } from "./event-store.js";
import { AuthManager } from "./auth.js";
import { WebhookNotifier } from "./webhook.js";
import { TaskBoard } from "./task-board.js";
import { PRBoard } from "./pr-board.js";
import { DashboardStore } from "./dashboard-store.js";
import { ScreenStore } from "./screen-store.js";
import { loadRoomConfig } from "./room-config.js";
import { createRoomInfoGetter } from "./room-info.js";
import { handleRestRoute } from "./routes/rest.js";
import { handleIpcCommand } from "./routes/ipc.js";
import { NotificationDispatcher } from "./notification.js";
import { TxListener } from "./tx-listener.js";
import { SubscriptionManager } from "./ws-subscribe.js";
import { json, readBody } from "./http-utils.js";
import type { ServerContext } from "./context.js";
import type { WorldMessage } from "./types.js";

// ── Room configuration ────────────────────────────────────────

const config = loadRoomConfig();
const RELAYS = process.env.WORLD_RELAYS?.split(",") ?? undefined;

// ── Core services ──────────────────────────────────────────────

const registry = new AgentRegistry();
const state = new WorldState(registry);
const nostr = new NostrWorld(RELAYS, config.roomId, config.roomName);
const clawhub = new ClawhubStore();
const eventStore = new EventStore();
const auth = new AuthManager();
const webhook = new WebhookNotifier(registry);
const taskBoard = new TaskBoard();
const prBoard = new PRBoard(process.env.PR_BOARD_REPO ?? "ryansoq/openclaw-alpha");
prBoard.start();
const dashboardStore = new DashboardStore();
const screenStore = new ScreenStore();
const messageStore = new (await import("./message-store.js")).MessageStore();

// ── Notification & TX Listener ─────────────────────────────────

// ClientManager needs to exist before NotificationDispatcher — defer init
let notificationDispatcher: NotificationDispatcher;
let txListener: TxListener;

// ── Game engine ─────────────────────────────────────────────────

const spatialGrid = new SpatialGrid(10);
const commandQueue = new CommandQueue();
const clientManager = new ClientManager();

notificationDispatcher = new NotificationDispatcher(registry, clientManager);
txListener = new TxListener(registry, messageStore, notificationDispatcher);

commandQueue.setObstacles([
  { x: -22, z: 0, radius: 2 },     // moltbook
  { x: 22, z: 0, radius: 3 },      // clawhub
  { x: 0, z: -22, radius: 3 },     // portal
  { x: -6, z: -10, radius: 0.5 },  // partition
  { x: 6, z: -10, radius: 0.5 },   // partition
  { x: -12, z: -10, radius: 2 },   // nami desk
  { x: 12, z: -10, radius: 2 },    // colleague desk
  { x: 0, z: 0, radius: 3 },       // meeting table
  { x: -12, z: 12, radius: 3 },    // sofa
  { x: -12, z: 14, radius: 1 },    // coffee table
  { x: -12, z: 17, radius: 1.5 },  // bookshelf
  { x: 12, z: 12, radius: 2.5 },   // tea counter
  { x: -20, z: -18, radius: 1.5 }, // bookshelf left
  { x: 20, z: -18, radius: 1.5 },  // bookshelf right
  { x: 0, z: -18, radius: 2 },     // whiteboard
]);

const gameLoop = new GameLoop(state, spatialGrid, commandQueue, clientManager, nostr, eventStore);

// ── Room info ──────────────────────────────────────────────────

const getRoomInfo = createRoomInfoGetter(
  config,
  () => state.getActiveAgentIds().size,
  () => nostr.getChannelId(),
);

// ── Shared context for route handlers ──────────────────────────

const ctx: ServerContext = {
  registry, state, eventStore, commandQueue, clawhub,
  nostr, clientManager, gameLoop, auth, webhook, taskBoard, prBoard,
  dashboardStore, screenStore, messageStore, config, getRoomInfo,
};

// ── HTTP server ─────────────────────────────────────────────────

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = req.url ?? "/";
  const method = req.method ?? "GET";

  // CORS preflight
  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  // REST API routes
  if (await handleRestRoute(req, res, ctx)) return;

  // IPC JSON API
  if (method === "POST" && (url === "/" || url === "/ipc")) {
    try {
      const parsed = await readBody(req);
      const result = await handleIpcCommand(parsed as Record<string, unknown>, ctx);
      return json(res, 200, result);
    } catch (err) {
      return json(res, 400, { error: String(err) });
    }
  }

  // ── Static file serving (dist/) ─────────────────────────────
  const { resolve, extname } = await import("node:path");
  const { readFile } = await import("node:fs/promises");
  const MIME: Record<string, string> = {
    ".html": "text/html", ".js": "application/javascript", ".css": "text/css",
    ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
    ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2",
  };
  const distDir = resolve(import.meta.dirname ?? ".", "../dist");
  const filePath = resolve(distDir, url === "/" ? "index.html" : url.slice(1).split("?")[0]);
  if (filePath.startsWith(distDir)) {
    try {
      const data = await readFile(filePath);
      const mime = MIME[extname(filePath)] ?? "application/octet-stream";
      res.writeHead(200, { "Content-Type": mime, "Access-Control-Allow-Origin": "*" });
      res.end(data);
      return;
    } catch {}
  }

  json(res, 404, { error: "Not found" });
});

// ── WebSocket subscription (external agents) ──────────────────

const subscriptionManager = new SubscriptionManager(server);
notificationDispatcher.setSubscriptionManager(subscriptionManager);

// ── WebSocket bridge ───────────────────────────────────────────

new WSBridge(server, clientManager, {
  getProfiles: () => {
    const activeIds = state.getActiveAgentIds();
    return registry.getAll().filter((p) => activeIds.has(p.agentId));
  },
  getProfile: (id) => registry.get(id),
  getRoomInfo,
});

// ── Nostr integration ──────────────────────────────────────────

nostr.setAgentValidator((agentId: string) => registry.get(agentId) !== undefined);
nostr.setMessageHandler((msg: WorldMessage) => { commandQueue.enqueue(msg); });

// ── Startup ────────────────────────────────────────────────────

async function main() {
  console.log("🏢 OpenClaw Online starting...");
  console.log(`[room] Room ID: ${config.roomId} | Name: "${config.roomName}"`);
  if (config.roomDescription) console.log(`[room] Description: ${config.roomDescription}`);
  console.log(`[room] Max agents: ${config.maxAgents} | Bind: ${config.host}:${config.port}`);
  console.log(`[engine] Tick rate: ${TICK_RATE}Hz | AOI radius: 40 units`);

  await nostr.init().catch((err) => {
    console.warn("[nostr] Init warning:", err.message ?? err);
    console.warn("[nostr] Running in local-only mode (no relay connection)");
  });

  server.listen(config.port, config.host, () => {
    console.log(`[server] IPC + WS listening on http://${config.host}:${config.port}`);
    console.log(`[server] Share Room ID "${config.roomId}" for others to join via Nostr`);
  });

  gameLoop.start();
  txListener.start();

  // Rebuild agent profiles from chain if profiles.json was empty
  if (registry.getAll().length === 0) {
    console.log("[startup] No local profiles — skipping chain rebuild (no addresses to scan)");
  } else {
    registry.rebuildFromChain().catch((err) => {
      console.warn("[startup] Chain rebuild warning:", err.message ?? err);
    });
  }

  // ── Heartbeat scanner: auto-idle & auto-kick ──────────────
  const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
  const KICK_TIMEOUT_MS = 120 * 60 * 1000;

  setInterval(() => {
    const now = Date.now();
    for (const profile of registry.getAll()) {
      if (!state.hasAgent(profile.agentId)) continue;
      const elapsed = now - profile.lastSeen;

      if (elapsed > KICK_TIMEOUT_MS) {
        console.log(`[heartbeat] ⏰ Kicking ${profile.agentId} (inactive ${Math.round(elapsed / 60000)}min)`);
        commandQueue.enqueue({ worldType: "leave", agentId: profile.agentId, timestamp: now });
      } else if (elapsed > IDLE_TIMEOUT_MS) {
        commandQueue.enqueue({ worldType: "action", agentId: profile.agentId, action: "idle", timestamp: now });
      }
    }
  }, 60_000);

  console.log(`[heartbeat] Scanner active: idle=${IDLE_TIMEOUT_MS / 60000}min, kick=${KICK_TIMEOUT_MS / 60000}min`);
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    console.log(`\n[server] ${sig} received, shutting down...`);
    gameLoop.stop();
    txListener.stop();
    eventStore.close();
    nostr.close();
    server.close();
    process.exit(0);
  });
}
