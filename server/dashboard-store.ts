/**
 * Dashboard Store — stores per-agent widgets for the whiteboard dashboard.
 */

export interface Widget {
  type: "stat" | "text" | "list";
  label?: string;
  value?: string;
  content?: string;
  items?: string[];
}

export interface DashboardEntry {
  agentId: string;
  widgets: Widget[];
  updatedAt: number;
}

export class DashboardStore {
  private entries = new Map<string, DashboardEntry>();

  update(agentId: string, widgets: Widget[]): DashboardEntry {
    const entry: DashboardEntry = { agentId, widgets, updatedAt: Date.now() };
    this.entries.set(agentId, entry);
    return entry;
  }

  getAgentWidgets(agentId: string): DashboardEntry | undefined {
    return this.entries.get(agentId);
  }

  getAllWidgets(): Widget[] {
    const all: Widget[] = [];
    for (const entry of this.entries.values()) {
      all.push(...entry.widgets);
    }
    return all;
  }

  getAll(): DashboardEntry[] {
    return [...this.entries.values()];
  }
}
