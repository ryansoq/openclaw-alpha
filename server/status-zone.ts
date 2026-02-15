/**
 * Agent Status → Zone auto-movement.
 *
 * Maps agent activity status to physical office zones.
 * When an agent reports a status change, they automatically
 * move to the corresponding zone in the office.
 */

export type AgentStatus =
  | "coding"      // 🖥️ writing code → own desk
  | "thinking"    // 🤔 planning/thinking → own desk
  | "chatting"    // 💬 in conversation → meeting table
  | "reviewing"   // 📋 code review → meeting table
  | "idle"        // 😴 doing nothing → pantry/lounge
  | "break"       // ☕ taking a break → pantry
  | "arriving"    // 🚪 just joined → entrance
  | "presenting"  // 📊 presenting → whiteboard area
  ;

interface ZonePoint {
  x: number;
  y: number;
  z: number;
  rotation: number;
}

/* ── Furniture obstacles (synced from client src/scene/buildings.ts) ── */
const FURNITURE: Array<{x: number; z: number; radius: number}> = [
  { x: -22, z: 0, radius: 2 },     // moltbook
  { x: 22, z: 0, radius: 3 },      // clawhub
  { x: 0, z: -22, radius: 3 },     // portal
  { x: -6, z: -10, radius: 0.5 },  // partition
  { x: 6, z: -10, radius: 0.5 },   // partition
  { x: -12, z: -10, radius: 2 },   // nami desk
  { x: 12, z: -10, radius: 2 },    // colleague desk
  { x: 0, z: 0, radius: 3 },       // meeting table
  { x: -12, z: 12, radius: 3 },    // sofa
  { x: -12, z: 14, radius: 1 },    // coffee table
  { x: -12, z: 17, radius: 1.5 },  // bookshelf
  { x: 12, z: 12, radius: 2.5 },   // tea counter
  { x: -20, z: -18, radius: 1.5 }, // bookshelf left
  { x: 20, z: -18, radius: 1.5 },  // bookshelf right
  { x: 0, z: -18, radius: 2 },     // whiteboard
];

const AGENT_RADIUS = 0.8;

/** Push a position out of any overlapping furniture. */
function resolvePosition(x: number, z: number): { x: number; z: number } {
  for (const f of FURNITURE) {
    const dx = x - f.x;
    const dz = z - f.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const minDist = f.radius + AGENT_RADIUS;
    if (dist < minDist) {
      const angle = Math.atan2(dz, dx);
      x = f.x + Math.cos(angle) * minDist;
      z = f.z + Math.sin(angle) * minDist;
    }
  }
  return { x, z };
}

/** Deterministic hash for agentId */
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** Office zone coordinates — positioned *beside* furniture, not inside */
const ZONES: Record<string, ZonePoint> = {
  "nami-desk":      { x: -12, y: 0, z: -7,  rotation: 0 },          // desk front (chair)
  "colleague-desk": { x: 12,  y: 0, z: -7,  rotation: 0 },          // desk front (chair)
  "meeting-table":  { x: 0,   y: 0, z: 3,   rotation: Math.PI },    // south side of table
  "pantry":         { x: 10,  y: 0, z: 10,  rotation: Math.PI },
  "sofa":           { x: -10, y: 0, z: 10,  rotation: Math.PI },    // in front of sofa
  "entrance":       { x: 0,   y: 0, z: 18,  rotation: Math.PI },
  "whiteboard":     { x: 0,   y: 0, z: -14, rotation: 0 },          // facing whiteboard
};

/** Status → zone mapping */
const STATUS_ZONE_MAP: Record<AgentStatus, string[]> = {
  coding:     ["nami-desk", "colleague-desk"],
  thinking:   ["nami-desk", "colleague-desk"],
  chatting:   ["meeting-table"],
  reviewing:  ["meeting-table"],
  idle:       ["pantry", "sofa"],
  break:      ["pantry"],
  arriving:   ["entrance"],
  presenting: ["whiteboard"],
};

/**
 * Resolve a zone position for a given agent + status.
 * Uses agentId hash to deterministically pick zone and spread agents.
 */
export function getZoneForStatus(
  agentId: string,
  status: AgentStatus,
): ZonePoint {
  const candidates = STATUS_ZONE_MAP[status] ?? STATUS_ZONE_MAP.idle;
  const hash = hashString(agentId);

  // Deterministic zone pick based on agentId
  const zoneKey = candidates[hash % candidates.length];
  const base = ZONES[zoneKey] ?? ZONES["entrance"];

  // Spread agents around zone center using hash-based angle
  const angle = ((hash % 360) / 360) * Math.PI * 2;
  const spread = 1.5; // radius of spread around zone center
  const rawX = base.x + Math.cos(angle) * spread;
  const rawZ = base.z + Math.sin(angle) * spread;

  // Resolve collisions with furniture
  const pos = resolvePosition(rawX, rawZ);

  return {
    x: pos.x,
    y: base.y,
    z: pos.z,
    rotation: base.rotation + ((hash % 60) - 30) * 0.01, // slight rotation variance
  };
}

/** Action animation to play when arriving at a zone */
export function getActionForStatus(status: AgentStatus): string {
  switch (status) {
    case "coding":
    case "thinking":
    case "reviewing":
      return "idle";  // sitting/working
    case "chatting":
    case "presenting":
      return "talk";
    case "idle":
    case "break":
      return "idle";
    case "arriving":
      return "wave";
    default:
      return "idle";
  }
}

/** Validate status string */
export function isValidStatus(s: string): s is AgentStatus {
  return s in STATUS_ZONE_MAP;
}
