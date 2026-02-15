import { execFile } from "node:child_process";
import { resolve } from "node:path";
import type { AgentRegistry } from "./agent-registry.js";
import type { MessageStore } from "./message-store.js";
import type { NotificationDispatcher } from "./notification.js";

const POLL_INTERVAL_MS = 10_000; // 10 seconds
const GET_TX_SCRIPT = resolve(process.cwd(), "skills/kaspa-wallet/scripts/get_transactions.py");

interface TxPayload {
  t: "msg";
  from: string;
  to: string;
  text: string;
  ts: number;
}

interface TxRecord {
  transaction_id: string;
  outputs?: Array<{ script_public_key_address?: string; amount?: number }>;
  payload?: string;
}

/**
 * Kaspa TX Listener — polls for new transactions to registered agent addresses.
 * Uses Python script `get_transactions.py` for fetching.
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
    // Initial poll after 5s
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
        // Don't spam logs — only warn once per cycle
        if (err.message?.includes("ENOENT")) {
          // Script not found — that's expected in dev
        } else {
          console.warn(`[tx-listener] Error polling ${agent.agentId}:`, err.message ?? err);
        }
      }
    }

    // Prune seen set if it gets too large
    if (this.seenTxIds.size > 50000) {
      const arr = Array.from(this.seenTxIds);
      this.seenTxIds = new Set(arr.slice(-25000));
    }
  }

  private fetchTransactions(address: string): Promise<TxRecord[]> {
    return new Promise((resolve, reject) => {
      execFile(
        "python3",
        [GET_TX_SCRIPT, address, "--network", "testnet", "--limit", "10"],
        { timeout: 15000 },
        (err, stdout, stderr) => {
          if (err) return reject(err);
          try {
            const data = JSON.parse(stdout);
            resolve(Array.isArray(data) ? data : data.transactions ?? []);
          } catch {
            reject(new Error(`Invalid JSON from get_transactions.py: ${stdout.slice(0, 200)}`));
          }
        },
      );
    });
  }

  private async processTx(tx: TxRecord): Promise<void> {
    if (!tx.payload) return;

    let payload: TxPayload;
    try {
      // Payload might be hex-encoded or UTF-8
      const decoded = tx.payload.startsWith("{")
        ? tx.payload
        : Buffer.from(tx.payload, "hex").toString("utf-8");
      payload = JSON.parse(decoded);
    } catch {
      return; // Not a message payload
    }

    if (payload.t !== "msg" || !payload.from || !payload.to || !payload.text) return;

    console.log(`[tx-listener] New message: ${payload.from} → ${payload.to}: ${payload.text.slice(0, 50)}`);

    // Store the message
    const msg = this.messageStore.add({
      from: payload.from,
      to: payload.to,
      text: payload.text.slice(0, 500),
      timestamp: payload.ts || Date.now(),
      txId: tx.transaction_id,
      status: "confirmed",
    });

    // Find sender's kaspa address
    const fromProfile = this.registry.get(payload.from);

    // Notify recipient
    await this.notifier.notify(payload.to, {
      type: "message",
      from: payload.from,
      fromAddress: fromProfile?.kaspaAddress,
      text: payload.text,
      txId: tx.transaction_id,
      timestamp: payload.ts || Date.now(),
    });
  }
}
