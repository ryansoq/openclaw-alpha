import type { AgentRegistry } from "./agent-registry.js";
import type { ClientManager } from "./client-manager.js";

export interface NotificationEvent {
  type: "message";
  from: string;
  fromAddress?: string;
  text: string;
  txId?: string;
  timestamp: number;
}

/**
 * Notification dispatcher — sends events to agents via their preferred method.
 */
export class NotificationDispatcher {
  constructor(
    private registry: AgentRegistry,
    private clientManager: ClientManager,
  ) {}

  /** Notify an agent about an event */
  async notify(agentId: string, event: NotificationEvent): Promise<void> {
    const profile = this.registry.get(agentId);
    if (!profile) return;

    const method = (profile as any).notifyMethod ?? "poll";

    // Always broadcast to WS clients (browser UI)
    this.broadcastToWs(agentId, event);

    if (method === "webhook" && profile.webhookUrl) {
      await this.sendWebhook(agentId, profile.webhookUrl, profile.webhookHeaders, event);
    }
    // 'ws' and 'poll' — WS broadcast already done above
  }

  /** Broadcast a new-message event to all connected WS clients */
  broadcastToWs(agentId: string, event: NotificationEvent): void {
    const payload = JSON.stringify({ type: "newMessage", agentId, event });
    this.clientManager.broadcast(payload);
  }

  private async sendWebhook(
    agentId: string,
    url: string,
    headers?: Record<string, string>,
    event?: NotificationEvent,
  ): Promise<void> {
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(5000),
      });
      console.log(`[notify] Webhook ${agentId} → ${resp.status}`);
    } catch (err: any) {
      console.warn(`[notify] Webhook failed for ${agentId}:`, err.message ?? err);
    }
  }
}
