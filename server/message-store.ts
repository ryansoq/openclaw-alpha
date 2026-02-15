import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export interface KaspaMessage {
  id: string;
  from: string;
  to: string;
  text: string;
  timestamp: number;
  txId?: string;       // on-chain TX ID (empty when mocked)
  status: "pending" | "sent" | "confirmed" | "failed";
}

const MESSAGES_PATH = resolve(process.cwd(), "messages.json");
const SAVE_DELAY_MS = 3000;

export class MessageStore {
  private messages: KaspaMessage[] = [];
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.load();
  }

  /** Add a new message */
  add(msg: Omit<KaspaMessage, "id">): KaspaMessage {
    const full: KaspaMessage = {
      ...msg,
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    };
    this.messages.push(full);
    // Keep max 10000 messages in memory
    if (this.messages.length > 10000) {
      this.messages = this.messages.slice(-5000);
    }
    this.scheduleSave();
    return full;
  }

  /** Get messages involving an agent (sent or received) */
  getForAgent(agentId: string, limit = 100): KaspaMessage[] {
    return this.messages
      .filter(m => m.from === agentId || m.to === agentId)
      .slice(-limit);
  }

  /** Get conversation between two agents */
  getConversation(agentA: string, agentB: string, limit = 50): KaspaMessage[] {
    return this.messages
      .filter(m =>
        (m.from === agentA && m.to === agentB) ||
        (m.from === agentB && m.to === agentA)
      )
      .slice(-limit);
  }

  /** Update message status (e.g. when TX confirms) */
  updateStatus(id: string, status: KaspaMessage["status"], txId?: string): boolean {
    const msg = this.messages.find(m => m.id === id);
    if (!msg) return false;
    msg.status = status;
    if (txId) msg.txId = txId;
    this.scheduleSave();
    return true;
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
