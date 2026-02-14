import type { AgentRegistry } from "./agent-registry.js";

/** Cooldown per agent to avoid spamming webhooks (ms) */
const COOLDOWN_MS = 60_000; // 1 minute

/**
 * Webhook notifier: sends HTTP POST to agents when they are @mentioned.
 * Generic — works with any agent platform that accepts HTTP callbacks.
 */
export class WebhookNotifier {
  private lastNotified = new Map<string, number>();

  constructor(private registry: AgentRegistry) {}

  /**
   * Scan a chat message for @mentions and fire webhooks.
   * Call this after a chat message is enqueued.
   */
  async notifyMentions(senderId: string, text: string): Promise<void> {
    const mentions = text.match(/@(\w+)/g);
    if (!mentions) return;

    const now = Date.now();
    const targets = new Set(
      mentions.map(m => m.slice(1).toLowerCase())
    );

    for (const targetId of targets) {
      if (targetId === senderId) continue; // Don't notify self

      const profile = this.registry.get(targetId);
      if (!profile?.webhookUrl) continue;

      // Cooldown check
      const lastTime = this.lastNotified.get(targetId) ?? 0;
      if (now - lastTime < COOLDOWN_MS) continue;

      this.lastNotified.set(targetId, now);
      this.fireWebhook(targetId, profile.webhookUrl, profile.webhookHeaders, {
        event: "mention",
        from: senderId,
        text: text.slice(0, 500),
        timestamp: now,
      }).catch(err => {
        console.warn(`[webhook] Failed to notify ${targetId}:`, err.message ?? err);
      });
    }
  }

  /** Fire a webhook (non-blocking) */
  private async fireWebhook(
    agentId: string,
    url: string,
    headers?: Record<string, string>,
    payload?: unknown,
  ): Promise<void> {
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      });
      console.log(`[webhook] Notified ${agentId} → ${resp.status}`);
    } catch (err) {
      throw err;
    }
  }
}
