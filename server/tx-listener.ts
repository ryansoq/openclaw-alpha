import type { AgentRegistry } from "./agent-registry.js";
import type { MessageStore } from "./message-store.js";
import type { NotificationDispatcher } from "./notification.js";

const POLL_INTERVAL_MS = 10_000; // 10 seconds
const KASPA_API = "https://api-tn10.kaspa.org";

interface KaspaTxOutput {
  script_public_key_address?: string;
  amount?: number;
}

interface KaspaTxInput {
  previous_outpoint_hash?: string;
  previous_outpoint_index?: number;
  previous_outpoint_address?: string;
}

interface KaspaTxRecord {
  transaction_id: string;
  inputs?: KaspaTxInput[];
  outputs?: KaspaTxOutput[];
  // payload is embedded in outputs[0] via OP_RETURN or script data
  // For Kaspa, the "payload" comes from the transaction's script data
}

interface ProtocolV1 {
  v: 1;
  t: string;
  d: string;
  a: Record<string, unknown>;
}

/**
 * Kaspa TX Listener — polls for new transactions to registered agent addresses.
 * Uses Kaspa REST API directly (no Python dependency).
 */
export class TxListener {
  private timer: ReturnType<typeof setInterval> | null = null;
  private seenTxIds = new Set<string>();
  private running = false;

  constructor(
    private registry: AgentRegistry,
    private messageStore: MessageStore,
    private notifier: NotificationDispatcher,
  ) {}

  start(): void {
    if (this.timer) return;
    console.log(`[tx-listener] Starting (poll every ${POLL_INTERVAL_MS / 1000}s)`);
    this.running = true;
    setTimeout(() => this.poll(), 5000);
    this.timer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
    console.log("[tx-listener] Stopped");
  }

  private async poll(): Promise<void> {
    if (!this.running) return;

    const agents = this.registry.getAll().filter(a => a.kaspaAddress);
    if (agents.length === 0) return;

    for (const agent of agents) {
      try {
        const txs = await this.fetchTransactions(agent.kaspaAddress!);
        for (const tx of txs) {
          if (this.seenTxIds.has(tx.transaction_id)) continue;
          this.seenTxIds.add(tx.transaction_id);
          await this.processTx(tx);
        }
      } catch (err: any) {
        console.warn(`[tx-listener] Error polling ${agent.agentId}:`, err.message ?? err);
      }
    }

    // Prune seen set if it gets too large
    if (this.seenTxIds.size > 50000) {
      const arr = Array.from(this.seenTxIds);
      this.seenTxIds = new Set(arr.slice(-25000));
    }
  }

  /** Fetch transactions via Kaspa REST API (no Python needed) */
  private async fetchTransactions(address: string): Promise<KaspaTxRecord[]> {
    const url = `${KASPA_API}/addresses/${address}/full-transactions?limit=50&resolve_previous_outpoints=light`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!resp.ok) {
      throw new Error(`Kaspa API ${resp.status}: ${resp.statusText}`);
    }
    const data: KaspaTxRecord[] = await resp.json() as KaspaTxRecord[];
    return Array.isArray(data) ? data : [];
  }

  private async processTx(tx: KaspaTxRecord): Promise<void> {
    // Try to extract payload from each output's script data
    // Kaspa embeds OP_RETURN data — we look for hex-encoded JSON in outputs
    const outputs = tx.outputs ?? [];
    const inputs = tx.inputs ?? [];

    // Find payload: check if any output has embedded data
    // The payload is typically in the transaction's first output script
    // For now, scan all outputs for decodable Protocol v1 messages
    let protocol: ProtocolV1 | null = null;

    // Try extracting payload from the transaction data
    // Kaspa REST API returns payload in the transaction object directly
    const txAny = tx as any;
    const rawPayload: string | undefined = txAny.payload ?? txAny.subnetwork_data;

    if (rawPayload) {
      protocol = this.decodePayload(rawPayload);
    }

    if (!protocol) return;

    // Determine from/to addresses
    // from: use resolved previous_outpoint_address from inputs, or "unknown"
    const fromAddress = inputs.find(i => i.previous_outpoint_address)?.previous_outpoint_address ?? "unknown";
    // to: outputs[0] is typically the recipient
    const toAddress = outputs[0]?.script_public_key_address ?? "unknown";

    console.log(`[tx-listener] Protocol v1 message: ${fromAddress} → ${toAddress}: ${protocol.d.slice(0, 50)}`);

    // Store the message
    const msg = this.messageStore.add({
      fromAddress,
      toAddress,
      protocol,
      timestamp: Date.now(),
      txId: tx.transaction_id,
      status: "confirmed",
    });

    // Notify recipient agent (if registered)
    const recipientAgent = this.registry.getAll().find(a => a.kaspaAddress === toAddress);
    if (recipientAgent) {
      await this.notifier.notify(recipientAgent.agentId, {
        type: "message",
        from: fromAddress,
        fromAddress,
        text: protocol.d,
        txId: tx.transaction_id,
        timestamp: msg.timestamp,
      });
    }
  }

  /** Decode a raw payload string into Protocol v1 format */
  private decodePayload(raw: string): ProtocolV1 | null {
    try {
      // Try hex decode first, then raw
      const decoded = raw.startsWith("{") ? raw : Buffer.from(raw, "hex").toString("utf-8");
      const parsed = JSON.parse(decoded);
      // Validate Protocol v1
      if (parsed.v === 1 && typeof parsed.t === "string" && typeof parsed.d === "string" && parsed.a !== undefined) {
        return parsed as ProtocolV1;
      }
    } catch {
      // Not a valid payload
    }
    return null;
  }
}
