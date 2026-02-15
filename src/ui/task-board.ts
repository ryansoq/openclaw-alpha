/**
 * Whiteboard Task Board UI
 *
 * Renders agent tasks on the 3D whiteboard via CSS2D overlay.
 * Listens for "task-board" WebSocket messages to update in real-time.
 */

interface TaskEntry {
  agentId: string;
  agentName: string;
  task: string;
  status: "active" | "blocked" | "done" | "idle";
  emoji: string;
  updatedAt: number;
}

const STATUS_COLORS: Record<string, string> = {
  active:  "#1e88e5",
  blocked: "#e53935",
  done:    "#43a047",
  idle:    "#9e9e9e",
};

let currentEntries: TaskEntry[] = [];

/** Call once on startup — fetches initial task list from server */
export async function initTaskBoard(serverUrl: string) {
  try {
    const res = await fetch(`${serverUrl}/ipc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "task-list" }),
    });
    const data = await res.json();
    if (data.ok && data.entries) {
      currentEntries = data.entries;
      render();
    }
  } catch {
    // Server might not be ready yet
  }
}

/** Called when a "task-board" WS message arrives */
export function handleTaskBoardMessage(entries: TaskEntry[]) {
  currentEntries = entries;
  render();
}

function render() {
  const el = document.getElementById("whiteboard-tasks");
  if (!el) return;

  if (currentEntries.length === 0) {
    el.innerHTML = `<div class="wb-empty">No active tasks</div>`;
    return;
  }

  const rows = currentEntries.slice(0, 8).map((e) => {
    const color = STATUS_COLORS[e.status] ?? STATUS_COLORS.idle;
    const age = timeSince(e.updatedAt);
    return `<div class="wb-row">
      <span class="wb-emoji">${e.emoji}</span>
      <span class="wb-name" style="color:${color}">${esc(e.agentName)}</span>
      <span class="wb-task">${esc(e.task)}</span>
      <span class="wb-age">${age}</span>
    </div>`;
  });

  el.innerHTML = `<div class="wb-title">📋 Task Board</div>${rows.join("")}`;
}

function timeSince(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
