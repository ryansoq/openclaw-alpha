import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import type { WorldMessage } from "./types.js";

const DATA_DIR = join(dirname(new URL(import.meta.url).pathname), "..", "data");
const EVENTS_FILE = join(DATA_DIR, "events.jsonl");

/** Max events to keep in file */
const MAX_PERSISTED = 2000;

/** Batch write interval (ms) */
const FLUSH_INTERVAL = 10_000;

/**
 * Append-only event store. Keeps recent events in memory + flushes to JSONL file.
 */
export class EventStore {
  private events: WorldMessage[] = [];
  private dirty = false;
  private flushTimer: ReturnType<typeof setInterval>;

  constructor() {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    this.load();
    this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL);
  }

  /** Append an event */
  append(ev: WorldMessage): void {
    this.events.push(ev);
    this.dirty = true;
    // Trim in memory if too large
    if (this.events.length > MAX_PERSISTED * 1.5) {
      this.events = this.events.slice(-MAX_PERSISTED);
    }
  }

  /** Query events since timestamp */
  query(sinceTs = 0, limit = 50): WorldMessage[] {
    const filtered = sinceTs > 0
      ? this.events.filter(e => e.timestamp > sinceTs)
      : this.events;
    return filtered.slice(-limit);
  }

  /** Flush to disk */
  flush(): void {
    if (!this.dirty) return;
    try {
      // Keep only last MAX_PERSISTED
      const toWrite = this.events.slice(-MAX_PERSISTED);
      const lines = toWrite.map(e => JSON.stringify(e)).join("\n") + "\n";
      writeFileSync(EVENTS_FILE, lines);
      this.events = toWrite;
      this.dirty = false;
    } catch (err) {
      console.error("[event-store] flush error:", err);
    }
  }

  /** Load from disk on startup */
  private load(): void {
    if (!existsSync(EVENTS_FILE)) return;
    try {
      const raw = readFileSync(EVENTS_FILE, "utf-8");
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        try {
          this.events.push(JSON.parse(line));
        } catch { /* skip bad lines */ }
      }
      console.log(`[event-store] Loaded ${this.events.length} events from disk`);
    } catch (err) {
      console.error("[event-store] load error:", err);
    }
  }

  /** Clean shutdown */
  close(): void {
    clearInterval(this.flushTimer);
    this.flush();
  }
}
