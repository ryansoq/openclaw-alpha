/**
 * Screen Display UI — overlay panel (click-to-open) showing agent screen content.
 * No more CSS2DObject on the 3D scene.
 */

interface ScreenContent {
  agentId: string;
  lines: string[];
  style: "terminal" | "markdown";
  updatedAt: number;
}

let screens: ScreenContent[] = [];
let serverUrl = "";

export interface ScreenDisplayAPI {
  showForDesk(deskId: string): void;
  hide(): void;
  isVisible(): boolean;
}

export function initScreenDisplay(_serverUrl: string): ScreenDisplayAPI {
  serverUrl = _serverUrl;

  // Initial fetch + poll
  fetchScreens();
  setInterval(fetchScreens, 30_000);

  const overlay = document.getElementById("building-overlay")!;
  let visible = false;

  function hide(): void {
    overlay.classList.remove("visible");
    visible = false;
  }

  function showForDesk(deskId: string): void {
    const panel = overlay.querySelector(".building-panel") as HTMLElement;
    panel.textContent = "";
    panel.className = "building-panel screen-display-panel";

    // Header
    const header = document.createElement("div");
    header.className = "bp-header";

    const title = document.createElement("h2");
    title.textContent = `🖥️ ${deskId}`;
    header.appendChild(title);

    const closeBtn = document.createElement("button");
    closeBtn.className = "bp-close";
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", hide);
    header.appendChild(closeBtn);

    panel.appendChild(header);

    // Find screen for this desk
    // Map desk index to screen: sort screens by agentId, match by desk index
    const sorted = [...screens].sort((a, b) => a.agentId.localeCompare(b.agentId));
    // Extract desk index from deskId (e.g. "desk-0" → 0, "desk-1" → 1, "desk" → 0)
    const match = deskId.match(/(\d+)/);
    const idx = match ? parseInt(match[1], 10) : 0;
    const screen = sorted[idx];

    const content = document.createElement("div");
    content.style.cssText = "padding:16px;overflow-y:auto;max-height:70vh;";

    if (!screen) {
      content.innerHTML = `<div style="color:#999;text-align:center;padding:40px 0">No screen content for this desk</div>`;
    } else {
      const isTerminal = screen.style === "terminal";
      const screenEl = document.createElement("div");
      screenEl.style.cssText = isTerminal
        ? "background:#0a0a0a;color:#33ff33;font-family:'Courier New',monospace;font-size:13px;line-height:1.5;padding:16px;border-radius:8px;white-space:pre-wrap;word-break:break-all;"
        : "background:#fafafa;color:#222;font-family:system-ui,sans-serif;font-size:13px;line-height:1.6;padding:16px;border-radius:8px;";

      const agentLabel = document.createElement("div");
      agentLabel.style.cssText = isTerminal
        ? "color:#33ff33;font-weight:600;margin-bottom:8px;opacity:0.7;"
        : "color:#666;font-weight:600;margin-bottom:8px;";
      agentLabel.textContent = `Agent: ${screen.agentId}`;
      screenEl.appendChild(agentLabel);

      for (const line of screen.lines) {
        const lineEl = document.createElement("div");
        lineEl.textContent = line;
        screenEl.appendChild(lineEl);
      }

      if (screen.lines.length === 0) {
        const empty = document.createElement("div");
        empty.style.opacity = "0.5";
        empty.textContent = "~ (empty)";
        screenEl.appendChild(empty);
      }

      content.appendChild(screenEl);
    }

    panel.appendChild(content);
    overlay.classList.add("visible");
    visible = true;
  }

  return { showForDesk, hide, isVisible: () => visible };
}

export function handleScreenUpdate(data: { screens: ScreenContent[] }): void {
  screens = data.screens;
}

async function fetchScreens(): Promise<void> {
  try {
    const res = await fetch(`${serverUrl}/api/screens`);
    const data = await res.json();
    if (data.ok && data.screens) {
      screens = data.screens;
    }
  } catch { /* server not ready */ }
}
