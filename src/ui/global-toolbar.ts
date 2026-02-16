/**
 * Global Toolbar — fixed top bar with tool buttons.
 * Replaces room-info-bar + overlay toolbar.
 */

export interface GlobalToolbarAPI {
  getElement(): HTMLElement;
  updateRoomInfo(info: { name: string; roomId: string; agents: number; maxAgents: number }): void;
}

interface ToolButton {
  id: string;
  icon: string;
  title: string;
  event: string;
  detail?: unknown;
}

const TOOLS: ToolButton[] = [
  { id: "zoom-in", icon: "🔍+", title: "Zoom in", event: "toolbar:zoom", detail: { dir: "in" } },
  { id: "zoom-out", icon: "🔍−", title: "Zoom out", event: "toolbar:zoom", detail: { dir: "out" } },
  { id: "toggle-3d", icon: "👁️", title: "Toggle 3D", event: "toolbar:toggle3d" },
  { id: "telecom", icon: "📡", title: "Telecom", event: "toolbar:telecom" },
  { id: "chat", icon: "💬", title: "World Chat", event: "toolbar:chat" },
];

export function setupGlobalToolbar(): GlobalToolbarAPI {
  const bar = document.createElement("div");
  bar.id = "global-toolbar";

  // Left: room info
  const infoSection = document.createElement("div");
  infoSection.className = "gt-info";
  bar.appendChild(infoSection);

  // Right: tool buttons
  const toolsSection = document.createElement("div");
  toolsSection.className = "gt-tools";

  for (const tool of TOOLS) {
    const btn = document.createElement("button");
    btn.className = "gt-btn";
    btn.id = `gt-${tool.id}`;
    btn.textContent = tool.icon;
    btn.title = tool.title;
    btn.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent(tool.event, { detail: tool.detail }));
      // Toggle active state for panels
      if (tool.id === "telecom" || tool.id === "chat") {
        btn.classList.toggle("active");
        // Deactivate sibling panel buttons
        const sibling = tool.id === "telecom" ? "chat" : "telecom";
        document.getElementById(`gt-${sibling}`)?.classList.remove("active");
      }
    });
    toolsSection.appendChild(btn);
  }

  bar.appendChild(toolsSection);

  // Insert at top of body
  document.body.prepend(bar);

  function updateRoomInfo(info: { name: string; roomId: string; agents: number; maxAgents: number }) {
    infoSection.textContent = "";

    const name = document.createElement("span");
    name.className = "gt-room-name";
    name.textContent = `🏢 ${info.name}`;
    infoSection.appendChild(name);

    const sep = document.createElement("span");
    sep.className = "gt-sep";
    sep.textContent = "|";
    infoSection.appendChild(sep);

    const agents = document.createElement("span");
    agents.className = "gt-agents";
    agents.textContent = `${info.agents}/${info.maxAgents} agents`;
    infoSection.appendChild(agents);
  }

  return { getElement: () => bar, updateRoomInfo };
}
