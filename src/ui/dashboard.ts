/**
 * Dashboard UI — overlay panel (click-to-open) showing agent widgets.
 * No more CSS2DObject on the 3D scene.
 */

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

let entries: DashboardEntry[] = [];
let serverUrl = "";

export interface DashboardAPI {
  show(): void;
  hide(): void;
  isVisible(): boolean;
}

export function initDashboard(_serverUrl: string, onViewPRs?: () => void): DashboardAPI {
  serverUrl = _serverUrl;

  // Initial fetch + poll
  fetchDashboard();
  setInterval(fetchDashboard, 30_000);

  const overlay = document.getElementById("building-overlay")!;
  let visible = false;

  function hide(): void {
    overlay.classList.remove("visible");
    visible = false;
  }

  function show(): void {
    const panel = overlay.querySelector(".building-panel") as HTMLElement;
    panel.textContent = "";
    panel.className = "building-panel dashboard-panel";

    // Header
    const header = document.createElement("div");
    header.className = "bp-header";

    const title = document.createElement("h2");
    title.textContent = "📊 Dashboard";
    header.appendChild(title);

    if (onViewPRs) {
      const prBtn = document.createElement("button");
      prBtn.textContent = "🔀 View PRs";
      prBtn.style.cssText = "background:#2196f3;color:#fff;border:none;padding:6px 14px;border-radius:4px;cursor:pointer;font-size:13px;margin-right:8px;";
      prBtn.addEventListener("click", () => { hide(); onViewPRs(); });
      header.appendChild(prBtn);
    }

    const closeBtn = document.createElement("button");
    closeBtn.className = "bp-close";
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", hide);
    header.appendChild(closeBtn);

    panel.appendChild(header);

    // Content
    const content = document.createElement("div");
    content.className = "dashboard-content";
    content.style.cssText = "padding:16px;overflow-y:auto;max-height:70vh;";
    renderWidgets(content);
    panel.appendChild(content);

    overlay.classList.add("visible");
    visible = true;
  }

  return { show, hide, isVisible: () => visible };
}

export function handleDashboardUpdate(data: { entries: DashboardEntry[] }): void {
  entries = data.entries;
}

async function fetchDashboard(): Promise<void> {
  try {
    const res = await fetch(`${serverUrl}/api/dashboard`);
    const data = await res.json();
    if (data.ok && data.entries) {
      entries = data.entries;
    }
  } catch { /* server not ready */ }
}

function renderWidgets(container: HTMLElement): void {
  if (entries.length === 0) {
    container.innerHTML = `<div style="color:#999;text-align:center;padding:40px 0">No dashboard data yet</div>`;
    return;
  }

  for (const entry of entries) {
    const section = document.createElement("div");
    section.style.cssText = "margin-bottom:16px;padding:12px;background:rgba(255,255,255,0.05);border-radius:8px;border:1px solid rgba(255,255,255,0.1);";

    const agentLabel = document.createElement("div");
    agentLabel.style.cssText = "font-weight:600;margin-bottom:8px;color:#64b5f6;font-size:14px;";
    agentLabel.textContent = `🤖 ${entry.agentId}`;
    section.appendChild(agentLabel);

    for (const w of entry.widgets) {
      const row = document.createElement("div");
      row.style.cssText = "margin:4px 0;font-size:13px;";

      switch (w.type) {
        case "stat":
          row.innerHTML = `<span style="color:#aaa">${esc(w.label ?? "")}:</span> <strong style="color:#fff">${esc(w.value ?? "")}</strong>`;
          break;
        case "text":
          row.style.color = "#ccc";
          row.textContent = w.content ?? "";
          break;
        case "list":
          if (w.label) {
            const lbl = document.createElement("div");
            lbl.style.cssText = "color:#aaa;font-weight:600;margin-bottom:2px;";
            lbl.textContent = w.label;
            row.appendChild(lbl);
          }
          if (w.items) {
            for (const item of w.items) {
              const li = document.createElement("div");
              li.style.cssText = "margin:0 0 0 12px;color:#ccc;";
              li.textContent = `• ${item}`;
              row.appendChild(li);
            }
          }
          break;
      }
      section.appendChild(row);
    }
    container.appendChild(section);
  }
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
