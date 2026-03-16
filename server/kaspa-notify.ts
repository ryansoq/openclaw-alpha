import type { AgentRegistry } from "./agent-registry.js";
import type { WebhookNotifier } from "./webhook.js";

const POLL_INTERVAL_MS = 15_000; // 15 seconds
const KASPA_API = process.env.KASPA_API ?? "https://api-tn10.kaspa.org";
const FETCH_HEADERS = { "User-Agent": "KaspaTelecom/1.0" };

interface KaspaTxOutput {
  script_public_key_address?: string;
  amount?: number;
}

interface KaspaTxInput {
  previous_outpoint_address?: string;
}

interface KaspaTxFull {
  transaction_id: string;
  payload?: string;
  subnetwork_id?: string;
  inputs?: KaspaTxInput[];
  outputs?: KaspaTxOutput[];
  block_time?: number;
}

export interface KaspaNotifyEvent {
  event: "kaspa-tx";
  from: string;
  to: string;
  amount: number;
  txId: string;
  payload: string;
  timestamp: number;
}

/**
 * Kaspa Agent Notification Service
 *
 * Monitors registered agents' Kaspa addresses for ALL incoming transactions
 * (not just protocol v1) and sends webhook/Telegram notifications.
 *
 * Runs alongside the existing TxListener which handles protocol messages.
 * This service handles the "you received funds/data" notifications.
 */
export class KaspaNotifyService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private seenTxIds = new Set<string>();
  private running = false;
  private initialized = false;

  constructor(
    private registry: AgentRegistry,
    private webhook: WebhookNotifier,
  ) {}

  start(): void {
    if (this.timer) return;
    console.log(`[kaspa-notify] Starting (poll every ${POLL_INTERVAL_MS / 1000}s)`);
    this.running = true;
    // First poll seeds the seen set (no notifications), subsequent polls notify
    setTimeout(() => this.poll(), 8000);
    this.timer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
    console.log("[kaspa-notify] Stopped");
  }

  private async poll(): Promise<void> {
    if (!this.running) return;

    const agents = this.registry.getAll().filter(a => a.kaspaAddress);
    if (agents.length === 0) return;

    for (const agent of agents) {
      try {
        const txs = await this.fetchRecentTxs(agent.kaspaAddress!);

        for (const tx of txs) {
          if (this.seenTxIds.has(tx.transaction_id)) continue;
          this.seenTxIds.add(tx.transaction_id);

          // Skip on first run (seed phase) to avoid flooding
          if (!this.initialized) continue;

          // Skip coinbase TXs (mining rewards) — no useful inputs, subnetwork 01...
          const isCoinbase = !tx.inputs?.length
            || tx.inputs.every(i => !i.previous_outpoint_address)
            || tx.subnetwork_id === "0100000000000000000000000000000000000000";
          if (isCoinbase) continue;

          // Check if this TX sends TO the agent's address
          const outputs = tx.outputs ?? [];
          const inputs = tx.inputs ?? [];
          const agentAddr = agent.kaspaAddress!;

          const incomingOutputs = outputs.filter(
            o => o.script_public_key_address === agentAddr
          );
          if (incomingOutputs.length === 0) continue;

          // Calculate total amount received (in sompi)
          const totalAmount = incomingOutputs.reduce(
            (sum, o) => sum + (o.amount ?? 0), 0
          );

          // Sender: first input address that isn't the agent itself
          const fromAddress = inputs
            .map(i => i.previous_outpoint_address)
            .find(a => a && a !== agentAddr)
            ?? inputs[0]?.previous_outpoint_address
            ?? "unknown";

          // Skip self-sends (including change outputs)
          if (fromAddress === agentAddr) continue;
          const allInputAddrs = new Set(inputs.map(i => i.previous_outpoint_address).filter(Boolean));
          if (allInputAddrs.has(agentAddr)) continue; // Agent sent this TX, skip change output

          // Decode payload if present
          let payloadText = "";
          if (tx.payload) {
            payloadText = this.decodePayload(tx.payload);
          }

          const event: KaspaNotifyEvent = {
            event: "kaspa-tx",
            from: fromAddress,
            to: agentAddr,
            amount: totalAmount,
            txId: tx.transaction_id,
            payload: payloadText,
            timestamp: tx.block_time ?? Date.now(),
          };

          // Find agent name for logging
          const fromAgent = this.registry.getAll().find(a => a.kaspaAddress === fromAddress);
          const fromName = fromAgent?.name ?? fromAddress.slice(0, 25) + "...";
          const kasToAmount = (totalAmount / 1e8).toFixed(8);

          console.log(
            `[kaspa-notify] Agent ${agent.name} received TX from ${fromName} ` +
            `(${kasToAmount} KAS, ${tx.transaction_id.slice(0, 16)}...)`,
          );

          // Send notification via WebhookNotifier
          await this.notifyAgent(agent.agentId, agent.name, fromName, event);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[kaspa-notify] Error polling ${agent.agentId}:`, msg);
      }
    }

    if (!this.initialized) {
      this.initialized = true;
      console.log(`[kaspa-notify] Seed complete, ${this.seenTxIds.size} TXs cached. Now monitoring.`);
    }

    // Prune seen set
    if (this.seenTxIds.size > 50000) {
      const arr = Array.from(this.seenTxIds);
      this.seenTxIds = new Set(arr.slice(-25000));
    }
  }

  /** Fetch recent TXs for an address */
  private async fetchRecentTxs(address: string): Promise<KaspaTxFull[]> {
    // First get TX list
    const listUrl = `${KASPA_API}/addresses/${address}/full-transactions?limit=20&resolve_previous_outpoints=full`;
    const listResp = await fetch(listUrl, {
      signal: AbortSignal.timeout(15000),
      headers: FETCH_HEADERS,
    });
    if (!listResp.ok) throw new Error(`Kaspa API ${listResp.status}`);
    const briefs = await listResp.json() as { transaction_id: string }[];
    if (!Array.isArray(briefs)) return [];

    // Fetch full details for unseen TXs (need payload)
    const results: KaspaTxFull[] = [];
    for (const brief of briefs) {
      if (this.seenTxIds.has(brief.transaction_id) && this.initialized) continue;

      try {
        const detailUrl = `${KASPA_API}/transactions/${brief.transaction_id}?inputs=true&outputs=true&resolve_previous_outpoints=full`;
        const resp = await fetch(detailUrl, {
          signal: AbortSignal.timeout(10000),
          headers: FETCH_HEADERS,
        });
        if (resp.ok) {
          results.push(await resp.json() as KaspaTxFull);
        }
      } catch {
        // Skip individual failures
      }
    }
    return results;
  }

  /** Decode hex payload to readable text */
  private decodePayload(raw: string): string {
    try {
      if (raw.startsWith("{")) return raw;
      const decoded = Buffer.from(raw, "hex").toString("utf-8");
      // Try parsing as JSON for readability
      try {
        const parsed = JSON.parse(decoded);
        if (parsed.v === 1 && parsed.d) return parsed.d;
        return decoded;
      } catch {
        return decoded;
      }
    } catch {
      return raw.slice(0, 200);
    }
  }

  /** Notify agent via webhook/Telegram using WebhookNotifier pattern */
  private async notifyAgent(
    agentId: string,
    agentName: string,
    fromName: string,
    event: KaspaNotifyEvent,
  ): Promise<void> {
    const kasAmount = (event.amount / 1e8).toFixed(4);
    const payloadSnippet = event.payload ? `\n📦 Payload: ${event.payload.slice(0, 100)}` : "";

    // Use the webhook notifier's mention system by crafting a synthetic mention
    // This triggers Telegram + webhook notifications through existing infrastructure
    const syntheticText =
      `@${agentId} 💰 Kaspa TX received!\n` +
      `From: ${fromName}\n` +
      `Amount: ${kasAmount} KAS\n` +
      `TX: ${event.txId.slice(0, 16)}...` +
      payloadSnippet;

    try {
      await this.webhook.notifyMentions("kaspa-notify", syntheticText, "kaspa-notify");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[kaspa-notify] Webhook notify failed for ${agentId}:`, msg);
    }
  }
}
