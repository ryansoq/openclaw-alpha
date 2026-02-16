import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { AgentProfile } from "./types.js";

const PROFILES_PATH = resolve(process.cwd(), "profiles.json");
const KASPA_API = process.env.KASPA_API ?? "https://api-tn10.kaspa.org";
const FETCH_HEADERS = { "User-Agent": "KaspaTelecom/1.0" };

/** Delay before flushing dirty profiles to disk */
const SAVE_DELAY_MS = 5000;

export class AgentRegistry {
  private profiles = new Map<string, AgentProfile>();
  private dirty = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.load();
  }

  /** Register or update an agent profile */
  register(profile: Partial<AgentProfile> & { agentId: string }): AgentProfile {
    const existing = this.profiles.get(profile.agentId);
    const now = Date.now();

    const merged: AgentProfile = {
      agentId: profile.agentId,
      name: profile.name ?? existing?.name ?? profile.agentId,
      pubkey: profile.pubkey ?? existing?.pubkey ?? "",
      bio: profile.bio?.slice(0, 500) ?? existing?.bio ?? "",
      capabilities: profile.capabilities ?? existing?.capabilities ?? [],
      skills: profile.skills ?? existing?.skills,
      color: profile.color ?? existing?.color ?? this.randomColor(),
      avatar: profile.avatar ?? existing?.avatar,
      webhookUrl: profile.webhookUrl ?? existing?.webhookUrl,
      webhookHeaders: profile.webhookHeaders ?? existing?.webhookHeaders,
      kaspaAddress: profile.kaspaAddress ?? existing?.kaspaAddress,
      notifyMethod: profile.notifyMethod ?? existing?.notifyMethod,
      contacts: profile.contacts ?? existing?.contacts ?? [],
      joinedAt: existing?.joinedAt ?? now,
      lastSeen: now,
    };

    this.profiles.set(profile.agentId, merged);
    this.scheduleSave();
    return merged;
  }

  /** Update lastSeen timestamp */
  touch(agentId: string): void {
    const profile = this.profiles.get(agentId);
    if (profile) {
      profile.lastSeen = Date.now();
      this.dirty = true;
    }
  }

  /** Get a single profile */
  get(agentId: string): AgentProfile | undefined {
    return this.profiles.get(agentId);
  }

  /** Get all profiles */
  getAll(): AgentProfile[] {
    return Array.from(this.profiles.values());
  }

  /** Remove an agent */
  remove(agentId: string): void {
    this.profiles.delete(agentId);
    this.scheduleSave();
  }

  /** Agents seen within last N milliseconds */
  getOnline(withinMs = 5 * 60 * 1000): AgentProfile[] {
    const cutoff = Date.now() - withinMs;
    return this.getAll().filter((p) => p.lastSeen >= cutoff);
  }

  /**
   * Rebuild agent profiles from on-chain register TXs.
   * Falls back to this when profiles.json is missing or empty.
   * Can also be called to supplement existing profiles with chain data.
   */
  async rebuildFromChain(addresses?: string[]): Promise<number> {
    const scanAddresses = addresses ?? this.getAll()
      .filter(a => a.kaspaAddress)
      .map(a => a.kaspaAddress!);

    if (scanAddresses.length === 0) {
      console.log("[registry] No addresses to scan for on-chain profiles");
      return 0;
    }

    let registered = 0;
    for (const address of scanAddresses) {
      try {
        const txListUrl = `${KASPA_API}/addresses/${address}/full-transactions?limit=50&resolve_previous_outpoints=full`;
        const listResp = await fetch(txListUrl, {
          signal: AbortSignal.timeout(15000),
          headers: FETCH_HEADERS,
        });
        if (!listResp.ok) continue;
        const txBriefs = await listResp.json() as { transaction_id: string }[];
        if (!Array.isArray(txBriefs)) continue;

        // Find the latest register TX by scanning each TX for payload
        let latestRegister: { data: Record<string, string>; fromAddress: string; blockTime: number } | null = null;

        for (const brief of txBriefs) {
          try {
            const detailUrl = `${KASPA_API}/transactions/${brief.transaction_id}?inputs=true&outputs=true&resolve_previous_outpoints=full`;
            const detailResp = await fetch(detailUrl, {
              signal: AbortSignal.timeout(10000),
              headers: FETCH_HEADERS,
            });
            if (!detailResp.ok) continue;
            const tx = await detailResp.json() as {
              payload?: string;
              block_time?: number;
              inputs?: { previous_outpoint_address?: string }[];
            };
            if (!tx.payload) continue;

            // Decode payload
            let decoded: string;
            try {
              decoded = tx.payload.startsWith("{") ? tx.payload : Buffer.from(tx.payload, "hex").toString("utf-8");
            } catch { continue; }

            let parsed: { v?: number; t?: string; d?: string };
            try { parsed = JSON.parse(decoded); } catch { continue; }

            if (parsed.v !== 1 || parsed.t !== "register" || !parsed.d) continue;

            const fromAddr = tx.inputs?.find(i => i.previous_outpoint_address)?.previous_outpoint_address;
            if (fromAddr !== address) continue;

            const blockTime = tx.block_time ?? 0;
            if (!latestRegister || blockTime > latestRegister.blockTime) {
              try {
                latestRegister = {
                  data: JSON.parse(parsed.d),
                  fromAddress: fromAddr,
                  blockTime,
                };
              } catch { /* invalid d JSON */ }
            }
          } catch { /* individual TX error, skip */ }
        }

        if (latestRegister) {
          const d = latestRegister.data as Record<string, unknown>;
          this.register({
            agentId: latestRegister.fromAddress,
            name: (d.name as string) ?? latestRegister.fromAddress,
            bio: (d.bio as string) ?? "",
            kaspaAddress: latestRegister.fromAddress,
            webhookUrl: d.webhook as string | undefined,
            capabilities: (d.capabilities as string[]) ?? [],
          });
          registered++;
          console.log(`[registry] 🔗 Rebuilt from chain: ${d.name ?? latestRegister.fromAddress}`);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[registry] Chain scan error for ${address}:`, msg);
      }
    }

    if (registered > 0) this.flush();
    console.log(`[registry] Chain rebuild complete: ${registered} profiles restored`);
    return registered;
  }

  private randomColor(): string {
    const colors = [
      "#e74c3c", "#e67e22", "#f39c12", "#2ecc71",
      "#1abc9c", "#3498db", "#9b59b6", "#e91e63",
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  private load(): void {
    try {
      if (existsSync(PROFILES_PATH)) {
        const data = JSON.parse(readFileSync(PROFILES_PATH, "utf-8"));
        if (Array.isArray(data)) {
          for (const p of data) {
            if (p.agentId) this.profiles.set(p.agentId, p);
          }
        }
      }
    } catch {
      // Start fresh if corrupt
    }
  }

  /** Schedule a debounced save — coalesces rapid mutations into one write */
  private scheduleSave(): void {
    this.dirty = true;
    if (!this.saveTimer) {
      this.saveTimer = setTimeout(() => {
        this.saveTimer = null;
        this.flush();
      }, SAVE_DELAY_MS);
    }
  }

  /** Immediately write to disk if dirty */
  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    try {
      writeFileSync(
        PROFILES_PATH,
        JSON.stringify(this.getAll(), null, 2),
        "utf-8"
      );
    } catch {
      // Non-fatal — profiles are also in-memory
    }
  }
}
