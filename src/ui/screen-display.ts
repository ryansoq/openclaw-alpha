/**
 * Screen Display UI — renders terminal/markdown content on desk screens via CSS2DObject.
 * Nami desk screen: (-12, 2.5, -10)
 * Colleague desk screen: (12, 2.5, -10)
 */

import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import * as THREE from "three";

interface ScreenContent {
  agentId: string;
  lines: string[];
  style: "terminal" | "markdown";
  updatedAt: number;
}

// Two screen positions: left (nami) and right (colleague)
const SCREEN_POSITIONS = [
  { x: -12, y: 2.8, z: -10 }, // nami desk
  { x: 12, y: 2.8, z: -10 },  // colleague desk
];

const screenLabels: CSS2DObject[] = [];
const screenDivs: HTMLDivElement[] = [];

export function initScreenDisplay(scene: THREE.Scene, serverUrl: string): void {
  for (let i = 0; i < SCREEN_POSITIONS.length; i++) {
    const div = document.createElement("div");
    div.className = "screen-display";
    Object.assign(div.style, {
      pointerEvents: "none",
      width: "160px",
      maxHeight: "100px",
      overflow: "hidden",
      padding: "4px 6px",
      fontFamily: "'Courier New', monospace",
      fontSize: "8px",
      lineHeight: "1.3",
      borderRadius: "3px",
      background: "rgba(0,0,0,0.9)",
      color: "#33ff33",
      textAlign: "left",
    });
    div.innerHTML = `<span style="color:#555">screen ${i}</span>`;

    const label = new CSS2DObject(div);
    const pos = SCREEN_POSITIONS[i];
    label.position.set(pos.x, pos.y, pos.z);
    scene.add(label);

    screenDivs.push(div);
    screenLabels.push(label);
  }

  // Initial fetch
  fetchScreens(serverUrl);
  // Poll every 30s
  setInterval(() => fetchScreens(serverUrl), 30_000);
}

export function handleScreenUpdate(data: { screens: ScreenContent[] }): void {
  renderScreens(data.screens);
}

async function fetchScreens(serverUrl: string): Promise<void> {
  try {
    const res = await fetch(`${serverUrl}/api/screens`);
    const data = await res.json();
    if (data.ok && data.screens) {
      renderScreens(data.screens);
    }
  } catch { /* server not ready */ }
}

function renderScreens(screens: ScreenContent[]): void {
  // Assign screens to desk positions using agentId hash
  // Sort screens by agentId for deterministic placement
  const sorted = [...screens].sort((a, b) => a.agentId.localeCompare(b.agentId));

  for (let i = 0; i < screenDivs.length; i++) {
    const screen = sorted[i];
    if (!screen) {
      screenDivs[i].innerHTML = `<span style="color:#555">_</span>`;
      continue;
    }

    const isTerminal = screen.style === "terminal";
    const bg = isTerminal ? "rgba(0,0,0,0.9)" : "rgba(255,255,255,0.9)";
    const fg = isTerminal ? "#33ff33" : "#222";

    screenDivs[i].style.background = bg;
    screenDivs[i].style.color = fg;

    let html = "";
    for (const line of screen.lines) {
      html += `<div>${esc(line)}</div>`;
    }
    screenDivs[i].innerHTML = html || `<span style="opacity:0.5">~</span>`;
  }
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
