/**
 * Screen Store — stores per-agent desk screen content.
 */

export interface ScreenContent {
  agentId: string;
  lines: string[];        // max 8 lines
  style: "terminal" | "markdown";
  updatedAt: number;
}

export class ScreenStore {
  private screens = new Map<string, ScreenContent>();

  update(agentId: string, lines: string[], style: "terminal" | "markdown" = "terminal"): ScreenContent {
    const content: ScreenContent = {
      agentId,
      lines: lines.slice(0, 8),
      style,
      updatedAt: Date.now(),
    };
    this.screens.set(agentId, content);
    return content;
  }

  get(agentId: string): ScreenContent | undefined {
    return this.screens.get(agentId);
  }

  getAll(): ScreenContent[] {
    return [...this.screens.values()];
  }
}
