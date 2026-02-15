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
  // Task board 3D rendering removed — PR Board overlay is now used instead
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
