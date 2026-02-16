import type { AgentRegistry } from "./agent-registry.js";
import type { ClientManager } from "./client-manager.js";
import type { SubscriptionManager, SubscriptionMessage } from "./ws-subscribe.js";

export interface NotificationEvent {
  type: "message";
  from: string;
  fromAddress?: string;
  toAddress?: string;
  text: string;
  txId?: string;
  timestamp: number;
  protocol?: { v: number; t: string; d: string; a: Record<string, unknown> };
}

/**
 * Notification dispatcher — sends events to agents via their preferred method.
 */
export class NotificationDispatcher {
  private subscriptionManager: SubscriptionManager | null = null;

  constructor(
    private registry: AgentRegistry,
    private clientManager: ClientManager,
  ) {}

  /** Attach the WS subscription manager (called after server creation) */
  setSubscriptionManager(sm: SubscriptionManager): void {
    this.subscriptionManager = sm;
  }

  /** Notify an agent about an event (by agentId) */
  async notify(agentId: string, event: NotificationEvent): Promise<void> {
    const profile = this.registry.get(agentId);
    if (!profile) return;

    const method = profile.notifyMethod ?? "poll";

    // Always broadcast to WS clients (browser UI)
    this.broadcastToWs(agentId, event);

    // Push to WS subscribers (external agents) if address known
    if (profile.kaspaAddress && this.subscriptionManager && event.protocol) {
      this.pushToSubscribers(profile.kaspaAddress, event);
    }

    if (method === "webhook" && profile.webhookUrl) {
      await this.sendWebhook(agentId, profile.webhookUrl, profile.webhookHeaders, event);
    }
    // 'ws' and 'poll' — WS broadcast already done above
  }

  /** Notify by Kaspa address (lookup agent, send webhook + WS push) */
  async notifyByAddress(address: string, event: NotificationEvent): Promise<void> {
    // Push to WS subscribers regardless of agent registration
    if (this.subscriptionManager && event.protocol) {
      this.pushToSubscribers(address, event);
    }

    // Find registered agent for webhook / UI broadcast
    const profile = this.registry.getAll().find(a => a.kaspaAddress === address);
    if (!profile) return;

    const method = profile.notifyMethod ?? "poll";

    // Broadcast to office UI
    this.broadcastToWs(profile.agentId, event);

    if (method === "webhook" && profile.webhookUrl) {
      await this.sendWebhook(profile.agentId, profile.webhookUrl, profile.webhookHeaders, event);
    }
  }

  /** Push to WS subscription clients for a specific address */
  private pushToSubscribers(address: string, event: NotificationEvent): void {
    if (!this.subscriptionManager) return;

    const msg: SubscriptionMessage = {
      type: "new_message",
      fromAddress: event.fromAddress ?? event.from,
      toAddress: event.toAddress ?? address,
      protocol: event.protocol ?? { v: 1, t: "msg", d: event.text, a: {} },
      txId: event.txId ?? "",
      timestamp: event.timestamp,
    };

    const sent = this.subscriptionManager.pushToAddress(address, msg);
    if (sent > 0) {
      console.log(`[notify] WS push to ${sent} subscriber(s) for ${address}`);
    }
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
