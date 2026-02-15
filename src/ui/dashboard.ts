/**
 * Dashboard UI — renders agent widgets on the whiteboard via CSS2DObject.
 * Whiteboard is at z:-18, width 6 units, height 3 units.
 */

import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import * as THREE from "three";

interface Widget {
  type: "stat" | "text" | "list";
  label?: string;
  value?: string;
  content?: string;
  items?: string[];
}

interface DashboardEntry {
  agentId: string;
  widgets: Widget[];
  updatedAt: number;
}

let dashboardLabel: CSS2DObject | null = null;
let dashboardDiv: HTMLDivElement | null = null;

export function initDashboard(scene: THREE.Scene, serverUrl: string): void {
  // Create the CSS2D overlay element
  dashboardDiv = document.createElement("div");
  dashboardDiv.className = "dashboard-overlay";
  Object.assign(dashboardDiv.style, {
    pointerEvents: "none",
    width: "280px",
    maxHeight: "160px",
    overflow: "hidden",
    padding: "6px 8px",
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    fontSize: "10px",
    lineHeight: "1.4",
    color: "#333",
    background: "rgba(255,255,255,0.85)",
    borderRadius: "4px",
    textAlign: "left",
  });
  dashboardDiv.textContent = "Dashboard";

  dashboardLabel = new CSS2DObject(dashboardDiv);
  // Position on the whiteboard (z:-18, centered)
  dashboardLabel.position.set(0, 3.2, -18);
  scene.add(dashboardLabel);

  // Initial fetch
  fetchDashboard(serverUrl);

  // Poll every 30s
  setInterval(() => fetchDashboard(serverUrl), 30_000);
}

export function handleDashboardUpdate(data: { entries: DashboardEntry[] }): void {
  renderWidgets(data.entries);
}

async function fetchDashboard(serverUrl: string): Promise<void> {
  try {
    const res = await fetch(`${serverUrl}/api/dashboard`);
    const data = await res.json();
    if (data.ok && data.entries) {
      renderWidgets(data.entries);
    }
  } catch { /* server not ready */ }
}

function renderWidgets(entries: DashboardEntry[]): void {
  if (!dashboardDiv) return;

  if (entries.length === 0) {
    dashboardDiv.innerHTML = `<div style="color:#999;text-align:center">📊 Dashboard</div>`;
    return;
  }

  let html = `<div style="font-weight:600;margin-bottom:3px;color:#1565c0;font-size:11px">📊 Dashboard</div>`;

  for (const entry of entries) {
    for (const w of entry.widgets) {
      switch (w.type) {
        case "stat":
          html += `<div style="margin:1px 0"><span style="color:#666">${esc(w.label ?? "")}:</span> <strong>${esc(w.value ?? "")}</strong></div>`;
          break;
        case "text":
          html += `<div style="margin:1px 0;color:#444">${esc(w.content ?? "")}</div>`;
          break;
        case "list":
          if (w.label) html += `<div style="margin:1px 0;color:#666;font-weight:600">${esc(w.label)}</div>`;
          if (w.items) {
            for (const item of w.items.slice(0, 5)) {
              html += `<div style="margin:0 0 0 6px;color:#444">• ${esc(item)}</div>`;
            }
          }
          break;
      }
    }
  }

  dashboardDiv.innerHTML = html;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
