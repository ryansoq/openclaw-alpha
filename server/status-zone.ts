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

/** Office zone coordinates (matching buildings.ts layout) */
const ZONES: Record<string, ZonePoint> = {
  "nami-desk":      { x: -10, y: 0, z: -12, rotation: 0 },         // sit at desk, face screen
  "colleague-desk": { x: 10,  y: 0, z: -12, rotation: 0 },
  "meeting-table":  { x: 2,   y: 0, z: 2,   rotation: Math.PI },   // around the table
  "pantry":         { x: 10,  y: 0, z: 10,  rotation: Math.PI },
  "sofa":           { x: -10, y: 0, z: 10,  rotation: Math.PI },
  "entrance":       { x: 0,   y: 0, z: 18,  rotation: Math.PI },
  "whiteboard":     { x: 0,   y: 0, z: -16, rotation: 0 },
};

/** Status → zone mapping, with slight random offset to avoid stacking */
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

/** Small random offset so agents don't overlap exactly */
function jitter(range = 2): number {
  return (Math.random() - 0.5) * range;
}

/**
 * Resolve a zone position for a given agent + status.
 * Uses agentId hash to consistently pick desk (left/right).
 */
export function getZoneForStatus(
  agentId: string,
  status: AgentStatus,
): ZonePoint {
  const candidates = STATUS_ZONE_MAP[status] ?? STATUS_ZONE_MAP.idle;

  // Deterministic zone pick based on agentId
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) {
    hash = ((hash << 5) - hash + agentId.charCodeAt(i)) | 0;
  }
  const zoneKey = candidates[Math.abs(hash) % candidates.length];
  const base = ZONES[zoneKey] ?? ZONES["entrance"];

  return {
    x: base.x + jitter(),
    y: base.y,
    z: base.z + jitter(),
    rotation: base.rotation + jitter(0.3),
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
