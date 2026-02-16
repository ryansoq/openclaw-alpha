import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export interface KaspaMessage {
  id: string;
  fromAddress: string;  // sender kaspa address (or "unknown")
  toAddress: string;    // recipient kaspa address
  protocol: { v: number; t: string; d: string; a: Record<string, unknown> };
  timestamp: number;
  txId: string;
  status: "confirmed";
}

const MESSAGES_PATH = resolve(process.cwd(), "messages.json");
const SAVE_DELAY_MS = 3000;

export class MessageStore {
  private messages: KaspaMessage[] = [];
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.load();
  }

  /** Add a new message (dedup by txId + toAddress) */
  add(msg: Omit<KaspaMessage, "id">): KaspaMessage {
    // Dedup: same TX to same recipient = same message
    if (msg.txId) {
      const dup = this.messages.find(m => m.txId === msg.txId && m.toAddress === msg.toAddress);
      if (dup) return dup;
    }
    const full: KaspaMessage = {
      ...msg,
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    };
    this.messages.push(full);
    if (this.messages.length > 10000) {
      this.messages = this.messages.slice(-5000);
    }
    this.scheduleSave();
    return full;
  }

  /** Get messages involving an address (sent or received) */
  getForAddress(address: string, limit = 100, since = 0): KaspaMessage[] {
    return this.messages
      .filter(m =>
        (m.fromAddress === address || m.toAddress === address) &&
        m.timestamp >= since
      )
      .slice(-limit);
  }

  /** Get the most recent N messages (across all addresses) */
  getRecent(limit = 20): KaspaMessage[] {
    return this.messages.slice(-limit);
  }

  /** Get platform message statistics */
  getStats(): { total: number; today: number } {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayTs = todayStart.getTime();
    const today = this.messages.filter(m => m.timestamp >= todayTs).length;
    return { total: this.messages.length, today };
  }

  private load(): void {
    try {
      if (existsSync(MESSAGES_PATH)) {
        const data = JSON.parse(readFileSync(MESSAGES_PATH, "utf-8"));
        if (Array.isArray(data)) this.messages = data;
      }
    } catch { /* start fresh */ }
  }

  private scheduleSave(): void {
    if (!this.saveTimer) {
      this.saveTimer = setTimeout(() => {
        this.saveTimer = null;
        this.flush();
      }, SAVE_DELAY_MS);
    }
  }

  flush(): void {
    try {
      writeFileSync(MESSAGES_PATH, JSON.stringify(this.messages, null, 2), "utf-8");
    } catch { /* non-fatal */ }
  }
}
