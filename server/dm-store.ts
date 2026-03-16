import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

export interface WhisperEntry {
  id: string;
  from: string;
  to: string;
  text: string;
  timestamp: number;
  read: boolean;
  encrypted?: boolean;
  txId?: string;
}

const WHISPER_PATH = resolve(process.cwd(), "data", "dm.jsonl");

export class DmStore {
  private entries: WhisperEntry[] = [];

  constructor() {
    this.load();
  }

  add(from: string, to: string, text: string, opts?: { encrypted?: boolean; txId?: string }): WhisperEntry {
    const entry: WhisperEntry = {
      id: `w_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      from,
      to,
      text,
      timestamp: Date.now(),
      read: false,
      ...(opts?.encrypted != null && { encrypted: opts.encrypted }),
      ...(opts?.txId != null && { txId: opts.txId }),
    };
    this.entries.push(entry);
    this.append(entry);
    return entry;
  }

  getConversation(agentA: string, agentB: string, limit = 50, since = 0): WhisperEntry[] {
    return this.entries
      .filter(e =>
        ((e.from === agentA && e.to === agentB) || (e.from === agentB && e.to === agentA)) &&
        e.timestamp >= since
      )
      .slice(-limit);
  }

  getInbox(agentId: string): { agentId: string; name?: string; lastMessage: string; lastTs: number; unread: number }[] {
    const convos = new Map<string, { lastMessage: string; lastTs: number; unread: number }>();
    for (const e of this.entries) {
      const other = e.from === agentId ? e.to : e.to === agentId ? e.from : null;
      if (!other) continue;
      const existing = convos.get(other);
      if (!existing || e.timestamp > existing.lastTs) {
        convos.set(other, {
          lastMessage: e.text,
          lastTs: e.timestamp,
          unread: (existing?.unread ?? 0) + (e.to === agentId && !e.read ? 1 : 0),
        });
      } else {
        if (e.to === agentId && !e.read) existing.unread++;
      }
    }
    return [...convos.entries()]
      .map(([id, c]) => ({ agentId: id, lastMessage: c.lastMessage, lastTs: c.lastTs, unread: c.unread }))
      .sort((a, b) => b.lastTs - a.lastTs);
  }

  markRead(agentId: string, fromAgentId: string): number {
    let count = 0;
    for (const e of this.entries) {
      if (e.to === agentId && e.from === fromAgentId && !e.read) {
        e.read = true;
        count++;
      }
    }
    if (count > 0) this.rewrite();
    return count;
  }

  getContacts(agentId: string): string[] {
    const contacts = new Set<string>();
    for (const e of this.entries) {
      if (e.from === agentId) contacts.add(e.to);
      if (e.to === agentId) contacts.add(e.from);
    }
    return [...contacts];
  }

  private load(): void {
    try {
      if (existsSync(WHISPER_PATH)) {
        const lines = readFileSync(WHISPER_PATH, "utf-8").split("\n").filter(Boolean);
        for (const line of lines) {
          try { this.entries.push(JSON.parse(line)); } catch { /* skip bad lines */ }
        }
      }
    } catch { /* start fresh */ }
  }

  private append(entry: WhisperEntry): void {
    try {
      const dir = dirname(WHISPER_PATH);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      appendFileSync(WHISPER_PATH, JSON.stringify(entry) + "\n");
    } catch { /* non-fatal */ }
  }

  private rewrite(): void {
    try {
      writeFileSync(WHISPER_PATH, this.entries.map(e => JSON.stringify(e)).join("\n") + "\n");
    } catch { /* non-fatal */ }
  }
}
