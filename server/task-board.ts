/**
 * Task Board — tracks what each agent is currently working on.
 *
 * Displayed on the office whiteboard in real-time.
 * Each agent can post/update their current task via IPC.
 */

export interface TaskEntry {
  agentId: string;
  agentName: string;
  task: string;         // e.g. "Reviewing PR #42"
  status: "active" | "blocked" | "done" | "idle";
  emoji: string;        // e.g. "🔨", "👀", "✅"
  updatedAt: number;    // epoch ms
}

const MAX_ENTRIES = 20;
const STALE_MS = 4 * 60 * 60 * 1000; // 4 hours

export class TaskBoard {
  private entries = new Map<string, TaskEntry>();

  /** Update or create a task entry for an agent */
  set(agentId: string, agentName: string, task: string, status: TaskEntry["status"] = "active", emoji?: string): TaskEntry {
    const entry: TaskEntry = {
      agentId,
      agentName,
      task: task.slice(0, 120),
      status,
      emoji: emoji ?? this.defaultEmoji(status),
      updatedAt: Date.now(),
    };
    this.entries.set(agentId, entry);
    this.prune();
    return entry;
  }

  /** Remove an agent's task */
  remove(agentId: string): boolean {
    return this.entries.delete(agentId);
  }

  /** Get all non-stale entries, newest first */
  list(): TaskEntry[] {
    this.prune();
    return [...this.entries.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  private prune() {
    const now = Date.now();
    for (const [id, e] of this.entries) {
      if (now - e.updatedAt > STALE_MS) this.entries.delete(id);
    }
    // Cap size
    if (this.entries.size > MAX_ENTRIES) {
      const sorted = [...this.entries.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt);
      while (this.entries.size > MAX_ENTRIES) {
        this.entries.delete(sorted.shift()![0]);
      }
    }
  }

  private defaultEmoji(status: TaskEntry["status"]): string {
    switch (status) {
      case "active":  return "🔨";
      case "blocked": return "🚧";
      case "done":    return "✅";
      case "idle":    return "💤";
    }
  }
}
