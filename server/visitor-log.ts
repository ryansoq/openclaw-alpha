import fs from "node:fs";
import path from "node:path";

interface VisitorRecord {
  name: string;
  color: string;
  bio: string;
  kaspaAddress?: string;
  skills?: string[];
  firstVisit: string;
  lastVisit: string;
  visitCount: number;
}

const LOG_PATH = path.join(process.cwd(), "data", "visitors.json");

export class VisitorLog {
  private visitors = new Map<string, VisitorRecord>();

  constructor() {
    this.load();
  }

  /** Record a visit (call on register) */
  record(agentId: string, profile: {
    name: string;
    color: string;
    bio: string;
    kaspaAddress?: string;
    skills?: { name: string }[];
  }): void {
    const now = new Date().toISOString();
    const existing = this.visitors.get(agentId);

    this.visitors.set(agentId, {
      name: existing?.name !== profile.name ? profile.name : (existing?.name ?? profile.name),
      color: profile.color || existing?.color || "#888",
      bio: profile.bio || existing?.bio || "",
      kaspaAddress: profile.kaspaAddress || existing?.kaspaAddress,
      skills: profile.skills?.map(s => s.name) || existing?.skills,
      firstVisit: existing?.firstVisit ?? now,
      lastVisit: now,
      visitCount: (existing?.visitCount ?? 0) + 1,
    });

    this.save();
  }

  /** Get all visitors */
  getAll(): Record<string, VisitorRecord> {
    return Object.fromEntries(this.visitors);
  }

  /** Get visitor count */
  count(): number {
    return this.visitors.size;
  }

  private load(): void {
    try {
      if (fs.existsSync(LOG_PATH)) {
        const data = JSON.parse(fs.readFileSync(LOG_PATH, "utf-8"));
        for (const [k, v] of Object.entries(data)) {
          this.visitors.set(k, v as VisitorRecord);
        }
        console.log(`[visitors] Loaded ${this.visitors.size} visitor records`);
      }
    } catch (e) {
      console.warn("[visitors] Failed to load:", e);
    }
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
      fs.writeFileSync(LOG_PATH, JSON.stringify(Object.fromEntries(this.visitors), null, 2));
    } catch (e) {
      console.warn("[visitors] Failed to save:", e);
    }
  }
}
