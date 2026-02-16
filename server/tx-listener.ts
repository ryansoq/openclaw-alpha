import type { AgentRegistry } from "./agent-registry.js";
import type { MessageStore } from "./message-store.js";
import type { NotificationDispatcher } from "./notification.js";

const POLL_INTERVAL_MS = 10_000; // 10 seconds
const KASPA_API = "https://api-tn10.kaspa.org";
const FETCH_HEADERS = { "User-Agent": "KaspaTelecom/1.0" };

interface KaspaTxBrief {
  transaction_id: string;
  inputs?: { previous_outpoint_address?: string }[];
  outputs?: { script_public_key_address?: string; amount?: number }[];
}

interface KaspaTxFull {
  transaction_id: string;
  payload?: string;
  subnetwork_id?: string;
  inputs?: { previous_outpoint_address?: string }[];
  outputs?: { script_public_key_address?: string; amount?: number }[];
  block_time?: number;
}

interface ProtocolV1 {
  v: 1;
  t: string;
  d: string;
  a: Record<string, unknown>;
}

/**
 * Kaspa TX Listener — polls for new transactions to registered agent addresses.
 * Uses Kaspa REST API: list TXs per address, then fetch each TX individually
 * to get payload (full-transactions endpoint doesn't include payload).
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
    // Initial poll after 5s, then every POLL_INTERVAL_MS
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
        // Step 1: Get TX ID list for this address
        const txBriefs = await this.fetchTxList(agent.kaspaAddress!);

        // Step 2: Filter unseen TXs
        const newTxIds = txBriefs
          .map(tx => tx.transaction_id)
          .filter(id => !this.seenTxIds.has(id));

        if (newTxIds.length === 0) continue;

        // Step 3: Fetch full TX details (with payload) for each new TX
        for (const txId of newTxIds) {
          this.seenTxIds.add(txId);
          try {
            const fullTx = await this.fetchTxDetail(txId);
            if (fullTx?.payload) {
              await this.processTx(fullTx);
            }
          } catch (err: any) {
            // Individual TX fetch failure — skip, don't block others
            console.warn(`[tx-listener] Error fetching TX ${txId.slice(0, 16)}:`, err.message ?? err);
          }
        }
      } catch (err: any) {
        console.warn(`[tx-listener] Error polling ${agent.agentId}:`, err.message ?? err);
      }
    }

    // Prune seen set
    if (this.seenTxIds.size > 50000) {
      const arr = Array.from(this.seenTxIds);
      this.seenTxIds = new Set(arr.slice(-25000));
    }
  }

  /** Get TX list for an address (no payload in this response) */
  private async fetchTxList(address: string): Promise<KaspaTxBrief[]> {
    const url = `${KASPA_API}/addresses/${address}/full-transactions?limit=20&resolve_previous_outpoints=full`;
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: FETCH_HEADERS,
    });
    if (!resp.ok) throw new Error(`Kaspa API ${resp.status}: ${resp.statusText}`);
    const data = await resp.json() as KaspaTxBrief[];
    return Array.isArray(data) ? data : [];
  }

  /** Fetch individual TX to get payload */
  private async fetchTxDetail(txId: string): Promise<KaspaTxFull | null> {
    const url = `${KASPA_API}/transactions/${txId}?inputs=true&outputs=true&resolve_previous_outpoints=full`;
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: FETCH_HEADERS,
    });
    if (!resp.ok) return null;
    return await resp.json() as KaspaTxFull;
  }

  private async processTx(tx: KaspaTxFull): Promise<void> {
    if (!tx.payload) return;

    const protocol = this.decodePayload(tx.payload);
    if (!protocol) return;

    const inputs = tx.inputs ?? [];
    const outputs = tx.outputs ?? [];

    // from: first input address
    const fromAddress = inputs.find(i => i.previous_outpoint_address)?.previous_outpoint_address ?? "unknown";
    // to: first output address (recipient)
    const toAddress = outputs[0]?.script_public_key_address ?? "unknown";

    // ── Handle register TX ──────────────────────────────────────
    if (protocol.t === "register") {
      console.log(`[tx-listener] 📋 Register TX from ${fromAddress.slice(0, 25)}... (TX: ${tx.transaction_id.slice(0, 16)}...)`);
      try {
        const profileData = JSON.parse(protocol.d) as {
          name?: string;
          bio?: string;
          webhook?: string;
          capabilities?: string[];
          skills?: { skillId: string; name: string; description?: string }[];
        };
        this.registry.register({
          agentId: fromAddress,
          name: profileData.name ?? fromAddress,
          bio: profileData.bio ?? "",
          kaspaAddress: fromAddress,
          webhookUrl: profileData.webhook,
          capabilities: profileData.capabilities ?? [],
          skills: profileData.skills,
        });
        console.log(`[tx-listener] ✅ Registered agent: ${profileData.name ?? fromAddress}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[tx-listener] ⚠️ Invalid register payload:`, msg);
      }
      return;
    }

    console.log(`[tx-listener] 📨 Protocol v1: ${fromAddress.slice(0, 25)}... → ${toAddress.slice(0, 25)}... (TX: ${tx.transaction_id.slice(0, 16)}...)`);

    // Store
    const msg = this.messageStore.add({
      fromAddress,
      toAddress,
      protocol,
      timestamp: tx.block_time ?? Date.now(),
      txId: tx.transaction_id,
      status: "confirmed",
    });

    // Notify
    await this.notifier.notifyByAddress(toAddress, {
      type: "message",
      from: fromAddress,
      fromAddress,
      toAddress,
      text: protocol.d,
      txId: tx.transaction_id,
      timestamp: msg.timestamp,
      protocol,
    });
  }

  /** Decode hex payload → Protocol v1 JSON */
  private decodePayload(raw: string): ProtocolV1 | null {
    try {
      const decoded = raw.startsWith("{") ? raw : Buffer.from(raw, "hex").toString("utf-8");
      const parsed = JSON.parse(decoded);
      if (parsed.v === 1 && typeof parsed.t === "string" && typeof parsed.d === "string" && parsed.a !== undefined) {
        return parsed as ProtocolV1;
      }
    } catch {
      // Not valid
    }
    return null;
  }
}
