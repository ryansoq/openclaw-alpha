import type { AgentRegistry } from "./agent-registry.js";
import { execFile } from "node:child_process";

/** Cooldown per agent to avoid spamming webhooks (ms) */
const COOLDOWN_MS = 10_000; // 10 seconds (was 60s)

/**
 * Webhook notifier: sends notifications to agents when they are @mentioned.
 * 
 * Supports two notification methods:
 * 1. **Telegram** (recommended): Set `telegramBotToken` + `telegramChatId` in profile.
 *    This sends a TG message that wakes up the agent's Gateway via existing TG webhook.
 * 2. **HTTP webhook** (legacy): Set `webhookUrl` in profile.
 */
export class WebhookNotifier {
  private lastNotified = new Map<string, number>();

  /** Map Office agentId → Telegram bot username (for clickable @mentions) */
  private static TG_USERNAMES: Record<string, string> = {
    nami: "@NamiElf_bot",
    bob: "@BobFix_bot",
  };

  private static tgName(agentId: string): string {
    return WebhookNotifier.TG_USERNAMES[agentId] ?? `@${agentId}`;
  }

  private port: number;
  constructor(private registry: AgentRegistry, port: number = 18800) {
    this.port = port;
  }

  /**
   * Scan a chat message for @mentions and fire notifications.
   * Call this after a chat message is enqueued.
   */
  async notifyMentions(senderId: string, text: string): Promise<void> {
    const mentions = text.match(/@([\w-]+)/g);
    if (!mentions) return;

    const now = Date.now();
    const targets = new Set(
      mentions.map(m => m.slice(1).toLowerCase())
    );

    for (const targetId of targets) {
      if (targetId === senderId) continue; // Don't notify self

      const profile = this.registry.get(targetId);
      if (!profile) continue;

      // Need at least one notification method
      const hasTelegram = profile.telegramBotToken && profile.telegramChatId;
      const hasWebhook = profile.webhookUrl;
      if (!hasTelegram && !hasWebhook) continue;

      // Cooldown check
      const lastTime = this.lastNotified.get(targetId) ?? 0;
      if (now - lastTime < COOLDOWN_MS) continue;

      this.lastNotified.set(targetId, now);

      const payload = {
        event: "mention" as const,
        from: senderId,
        text: text.slice(0, 500),
        timestamp: now,
      };

      // Prefer Telegram, fallback to HTTP webhook
      if (hasTelegram) {
        this.notifyTelegram(
          targetId,
          profile.telegramBotToken!,
          profile.telegramChatId!,
          senderId,
          text,
        ).catch(err => {
          console.warn(`[telegram] Failed to notify ${targetId}:`, err.message ?? err);
        });
      } else if (hasWebhook) {
        this.fireWebhook(targetId, profile.webhookUrl!, profile.webhookHeaders, payload)
          .catch(err => {
            console.warn(`[webhook] Failed to notify ${targetId}:`, err.message ?? err);
          });
      }
    }
  }

  /** Auto-wake timeout: if human doesn't cancel within this time, auto-reply */
  private static AUTO_WAKE_MS = 999_999_999; // disabled for testing
  private pendingWakes = new Map<string, NodeJS.Timeout>();

  /** Send a Telegram message to wake up an agent (uses curl to avoid Node.js network issues in WSL) */
  private async notifyTelegram(
    agentId: string,
    botToken: string,
    chatId: string,
    fromId: string,
    text: string,
  ): Promise<void> {
    const from = WebhookNotifier.tgName(fromId);
    const to = WebhookNotifier.tgName(agentId);
    const message = `🏢 Office mention\n👤 ${from} → ${to}\n💬 ${text.slice(0, 200)}`;
    
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify({
        chat_id: chatId,
        text: message,
        disable_notification: false,
        // No buttons — just a clean notification
      });
      execFile("curl", [
        "-s", "-X", "POST",
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        "-H", "Content-Type: application/json",
        "-d", payload,
        "--connect-timeout", "10",
      ], { timeout: 15000 }, (err, stdout, stderr) => {
        if (err) {
          console.error(`[telegram] curl error for ${agentId}:`, err.message);
          return reject(err);
        }
        console.log(`[telegram] Notified ${agentId} via curl → ${stdout.slice(0, 80)}`);
        
        // Parse message_id for later editing
        try {
          const resp = JSON.parse(stdout);
          const msgId = resp?.result?.message_id;
          if (msgId) {
            this.startAutoWake(agentId, botToken, chatId, msgId, fromId, text);
          }
        } catch {}
        
        resolve();
      });
    });
  }

  /** Start 30s timer — if not cancelled, auto-send wake message */
  private startAutoWake(
    agentId: string, botToken: string, chatId: string,
    msgId: number, fromId: string, originalText: string,
  ): void {
    // Clear any existing timer for this agent
    const existing = this.pendingWakes.get(agentId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.pendingWakes.delete(agentId);
      console.log(`[auto-wake] Timer expired for ${agentId}, sending wake message`);
      
      // Edit the original message to show it auto-fired
      const editPayload = JSON.stringify({
        chat_id: chatId,
        message_id: msgId,
        text: `🏢 Office @mention (auto-wake ⚡)\n👤 ${fromId} → @${agentId}\n💬 ${originalText.slice(0, 200)}\n\n✅ 自動喚醒已觸發`,
        reply_markup: { inline_keyboard: [] },
      });
      execFile("curl", [
        "-s", "-X", "POST",
        `https://api.telegram.org/bot${botToken}/editMessageText`,
        "-H", "Content-Type: application/json",
        "-d", editPayload,
        "--connect-timeout", "10",
      ], { timeout: 10000 }, () => {});
      
      // Auto-reply in Office on behalf of the agent
      const autoReply = JSON.stringify({
        command: "world-chat",
        args: { agentId, text: `👋 收到 @${fromId} 的訊息！我稍後會詳細回覆。(auto-reply ⚡)` },
      });
      // Use internal IPC (no auth needed for auto-reply from server)
      fetch(`http://127.0.0.1:${this.port}/ipc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: autoReply,
      }).catch(() => {
        // Fallback: use curl
        execFile("curl", [
          "-s", "-X", "POST", `http://127.0.0.1:${this.port}/ipc`,
          "-H", "Content-Type: application/json",
          "-d", autoReply,
        ], { timeout: 5000 }, () => {});
      });
      console.log(`[auto-wake] Auto-replied in Office for ${agentId}`);
    }, WebhookNotifier.AUTO_WAKE_MS);

    this.pendingWakes.set(agentId, timer);
  }

  /** Cancel auto-wake (called when human presses cancel) */
  cancelAutoWake(agentId: string): boolean {
    const timer = this.pendingWakes.get(agentId);
    if (timer) {
      clearTimeout(timer);
      this.pendingWakes.delete(agentId);
      console.log(`[auto-wake] Cancelled for ${agentId}`);
      return true;
    }
    return false;
  }

  /** Fire an HTTP webhook (legacy) */
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
