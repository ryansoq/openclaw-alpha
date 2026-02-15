import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ServerContext } from "../context.js";
import type { WorldMessage, JoinMessage, PositionMessage, AgentSkillDeclaration } from "../types.js";
import { getZoneForStatus, getActionForStatus, isValidStatus } from "../status-zone.js";

/**
 * Handle IPC commands. Called from POST /ipc endpoint.
 */
export async function handleIpcCommand(
  parsed: Record<string, unknown>,
  ctx: ServerContext,
): Promise<unknown> {
  const { command, args } = parsed as {
    command: string;
    args?: Record<string, unknown>;
  };

  // Commands that require a registered agentId + valid token
  const agentCommands = new Set([
    "world-move", "world-action", "world-chat", "world-whisper", "world-emote", "world-leave", "world-status",
  ]);
  if (agentCommands.has(command)) {
    const agentId = (args as { agentId?: string })?.agentId;
    if (!agentId || !ctx.registry.get(agentId)) {
      throw new Error("Unknown or unregistered agentId");
    }
    const token = (parsed as { token?: string }).token;
    if (!ctx.auth.validate(token, agentId)) {
      throw new Error("Invalid or missing auth token. Register first to get a token.");
    }
  }

  switch (command) {
    // ── Registration ──────────────────────────────────────────
    case "register": {
      const onlineCount = ctx.state.getActiveAgentIds().size;
      if (onlineCount >= ctx.config.maxAgents) {
        return { ok: false, error: `Room is full (${ctx.config.maxAgents} max)` };
      }

      const a = args as {
        agentId: string; name?: string; pubkey?: string; bio?: string;
        capabilities?: string[]; color?: string; skills?: AgentSkillDeclaration[];
        webhookUrl?: string; webhookHeaders?: Record<string, string>;
      };
      if (!a?.agentId) throw new Error("agentId required");
      const profile = ctx.registry.register(a);

      const joinMsg: JoinMessage = {
        worldType: "join",
        agentId: profile.agentId,
        name: profile.name,
        color: profile.color,
        bio: profile.bio,
        capabilities: profile.capabilities,
        skills: profile.skills,
        timestamp: Date.now(),
      };
      ctx.commandQueue.enqueue(joinMsg);

      if (!ctx.state.getPosition(profile.agentId)) {
        const posMsg: PositionMessage = {
          worldType: "position",
          agentId: profile.agentId,
          x: (Math.random() - 0.5) * 10,
          y: 0,
          z: 18 + (Math.random() - 0.5) * 4,
          rotation: Math.PI,
          timestamp: Date.now(),
        };
        ctx.commandQueue.enqueue(posMsg);
      }

      const token = ctx.auth.issueToken(profile.agentId);
      const previewUrl = `http://localhost:${process.env.VITE_PORT ?? "3000"}/?agent=${encodeURIComponent(profile.agentId)}`;
      return { ok: true, profile, token, previewUrl, ipcUrl: `http://127.0.0.1:${ctx.config.port}/ipc` };
    }

    // ── Profiles ──────────────────────────────────────────────
    case "profiles":
      return { ok: true, profiles: ctx.registry.getAll() };

    case "profile": {
      const agentId = (args as { agentId?: string })?.agentId;
      if (!agentId) throw new Error("agentId required");
      const profile = ctx.registry.get(agentId);
      return profile ? { ok: true, profile } : { ok: false, error: "not found" };
    }

    // ── World commands ────────────────────────────────────────
    case "world-move": {
      const a = args as { agentId: string; x: number; y: number; z: number; rotation?: number };
      if (!a?.agentId) throw new Error("agentId required");
      const x = Number(a.x ?? 0), y = Number(a.y ?? 0), z = Number(a.z ?? 0), rotation = Number(a.rotation ?? 0);
      if (!isFinite(x) || !isFinite(y) || !isFinite(z) || !isFinite(rotation)) {
        throw new Error("x, y, z, rotation must be finite numbers");
      }
      const msg: WorldMessage = { worldType: "position", agentId: a.agentId, x, y, z, rotation, timestamp: Date.now() };
      const result = ctx.commandQueue.enqueue(msg);
      if (!result.ok) return { ok: false, error: result.reason };
      return { ok: true };
    }

    case "world-action": {
      const a = args as { agentId: string; action: string; targetAgentId?: string };
      if (!a?.agentId) throw new Error("agentId required");
      const msg: WorldMessage = {
        worldType: "action", agentId: a.agentId,
        action: (a.action ?? "idle") as "walk" | "idle" | "wave" | "pinch" | "talk" | "dance" | "backflip" | "spin",
        targetAgentId: a.targetAgentId, timestamp: Date.now(),
      };
      ctx.commandQueue.enqueue(msg);
      return { ok: true };
    }

    case "world-chat": {
      const a = args as { agentId: string; text: string };
      if (!a?.agentId || !a?.text) throw new Error("agentId and text required");
      const text = a.text.slice(0, 500);
      const profile = ctx.registry.get(a.agentId);
      const msg: WorldMessage = { worldType: "chat", agentId: a.agentId, text, timestamp: Date.now(), name: profile?.name ?? a.agentId };
      ctx.commandQueue.enqueue(msg);
      // Fire webhooks for @mentions (non-blocking)
      ctx.webhook.notifyMentions(a.agentId, text);
      return { ok: true };
    }

    case "world-whisper": {
      const a = args as { agentId: string; targetId: string; text: string };
      if (!a?.agentId || !a?.targetId || !a?.text) throw new Error("agentId, targetId, and text required");
      const text = a.text.slice(0, 500);
      const msg: WorldMessage = {
        worldType: "whisper", agentId: a.agentId, targetId: a.targetId,
        text, timestamp: Date.now(),
      };
      ctx.commandQueue.enqueue(msg);
      // Wake target agent via webhook (non-blocking)
      ctx.webhook.notifyMentions(a.agentId, `@${a.targetId} ${text}`);
      return { ok: true };
    }

    case "world-emote": {
      const a = args as { agentId: string; emote: string };
      if (!a?.agentId) throw new Error("agentId required");
      const msg: WorldMessage = {
        worldType: "emote", agentId: a.agentId,
        emote: (a.emote ?? "happy") as "happy" | "thinking" | "surprised" | "laugh",
        timestamp: Date.now(),
      };
      ctx.commandQueue.enqueue(msg);
      return { ok: true };
    }

    case "world-status": {
      const a = args as { agentId: string; status: string };
      if (!a?.agentId) throw new Error("agentId required");
      if (!a?.status || !isValidStatus(a.status)) {
        throw new Error("Valid status required: coding, thinking, chatting, reviewing, idle, break, arriving, presenting");
      }
      const zone = getZoneForStatus(a.agentId, a.status);
      const posMsg: WorldMessage = {
        worldType: "position", agentId: a.agentId,
        x: zone.x, y: zone.y, z: zone.z, rotation: zone.rotation,
        timestamp: Date.now(),
      };
      ctx.commandQueue.enqueue(posMsg);
      const action = getActionForStatus(a.status);
      const actMsg: WorldMessage = {
        worldType: "action", agentId: a.agentId,
        action: action as "idle" | "walk" | "wave" | "talk",
        timestamp: Date.now(),
      };
      ctx.commandQueue.enqueue(actMsg);
      return { ok: true, status: a.status, zone: { x: zone.x, z: zone.z } };
    }

    case "world-leave": {
      const a = args as { agentId: string };
      if (!a?.agentId) throw new Error("agentId required");
      const msg: WorldMessage = { worldType: "leave", agentId: a.agentId, timestamp: Date.now() };
      ctx.commandQueue.enqueue(msg);
      return { ok: true };
    }

    // ── Clawhub ───────────────────────────────────────────────
    case "clawhub-list":
      return { ok: true, skills: ctx.clawhub.list() };

    case "clawhub-publish": {
      const a = args as { id?: string; name?: string; description?: string; author?: string; version?: string; tags?: string[] };
      if (!a?.id || !a?.name) throw new Error("id and name required");
      const skill = ctx.clawhub.publish({
        id: a.id, name: a.name, description: a.description ?? "",
        author: a.author ?? "unknown", version: a.version ?? "0.1.0", tags: a.tags ?? [],
      });
      return { ok: true, skill };
    }

    case "clawhub-install": {
      const a = args as { skillId?: string };
      if (!a?.skillId) throw new Error("skillId required");
      const record = ctx.clawhub.install(a.skillId);
      if (!record) throw new Error("skill not found");
      return { ok: true, installed: record };
    }

    case "clawhub-uninstall": {
      const a = args as { skillId?: string };
      if (!a?.skillId) throw new Error("skillId required");
      return { ok: ctx.clawhub.uninstall(a.skillId) };
    }

    // ── Room management ───────────────────────────────────────
    case "room-info":
      return { ok: true, ...ctx.getRoomInfo() };

    case "room-events": {
      const a = args as { since?: number; limit?: number };
      return { ok: true, events: ctx.eventStore.query(Number(a?.since ?? 0), Math.min(Number(a?.limit ?? 50), 200)) };
    }

    case "room-whispers": {
      const wa = args as { agent?: string; since?: number; limit?: number };
      if (!wa?.agent) return { ok: false, error: "agent param required" };
      const since = Number(wa.since ?? 0);
      const limit = Math.min(Number(wa.limit ?? 20), 100);
      const allEvents = ctx.eventStore.query(since, 500);
      const whispers = allEvents
        .filter(e => e.worldType === "whisper" && ((e as any).targetId === wa.agent || e.agentId === wa.agent))
        .slice(-limit);
      return { ok: true, agent: wa.agent, whispers, count: whispers.length };
    }

    case "room-mentions": {
      const ma = args as { agent?: string; since?: number; limit?: number };
      if (!ma?.agent) return { ok: false, error: "agent param required" };
      const since = Number(ma.since ?? 0);
      const limit = Math.min(Number(ma.limit ?? 20), 100);
      const pattern = new RegExp(`@${ma.agent}\\b`, "i");
      const allEvents = ctx.eventStore.query(since, 500);
      const mentions = allEvents
        .filter(e => e.worldType === "chat" && e.agentId !== ma.agent && pattern.test((e as any).text ?? ""))
        .slice(-limit);
      return { ok: true, agent: ma.agent, mentions, count: mentions.length };
    }

    case "room-invite": {
      const info = ctx.getRoomInfo();
      return {
        ok: true,
        invite: {
          roomId: info.roomId, name: info.name,
          relays: ctx.nostr.getRelays(), channelId: ctx.nostr.getChannelId(),
          agents: info.agents, maxAgents: info.maxAgents,
        },
      };
    }

    case "room-skills": {
      const allProfiles = ctx.registry.getAll();
      const directory: Record<string, { agentId: string; agentName: string; skill: AgentSkillDeclaration }[]> = {};
      for (const p of allProfiles) {
        for (const skill of p.skills ?? []) {
          if (!directory[skill.skillId]) directory[skill.skillId] = [];
          directory[skill.skillId].push({ agentId: p.agentId, agentName: p.name, skill });
        }
      }
      return { ok: true, directory };
    }

    // ── Task Board ──────────────────────────────────────────
    case "task-update": {
      const a = args as { agentId: string; task?: string; status?: string; emoji?: string };
      if (!a?.agentId) throw new Error("agentId required");
      const token = (parsed as { token?: string }).token;
      if (!ctx.auth.validate(token, a.agentId)) throw new Error("Invalid auth token");
      const validStatuses = new Set(["active", "blocked", "done", "idle"]);
      const status = validStatuses.has(a.status ?? "") ? a.status as "active" | "blocked" | "done" | "idle" : "active";
      const profile = ctx.registry.get(a.agentId);
      const entry = ctx.taskBoard.set(a.agentId, profile?.name ?? a.agentId, a.task ?? "Working...", status, a.emoji);
      // Broadcast update to all WS clients
      ctx.clientManager.broadcast(JSON.stringify({ type: "task-board", entries: ctx.taskBoard.list() }));
      return { ok: true, entry };
    }

    case "task-remove": {
      const a = args as { agentId: string };
      if (!a?.agentId) throw new Error("agentId required");
      const token = (parsed as { token?: string }).token;
      if (!ctx.auth.validate(token, a.agentId)) throw new Error("Invalid auth token");
      ctx.taskBoard.remove(a.agentId);
      ctx.clientManager.broadcast(JSON.stringify({ type: "task-board", entries: ctx.taskBoard.list() }));
      return { ok: true };
    }

    case "task-list":
      return { ok: true, entries: ctx.taskBoard.list() };

    // ── PR Board ──────────────────────────────────────────
    case "pr-list":
      return { ok: true, prs: ctx.prBoard.list() };

    case "pr-refresh": {
      const token = (parsed as { token?: string }).token;
      const agentId = (args as { agentId?: string })?.agentId;
      if (!agentId || !ctx.auth.validate(token, agentId)) {
        throw new Error("Invalid or missing auth token. Register first to get a token.");
      }
      return { ok: true, prs: await ctx.prBoard.refresh() };
    }

    case "describe": {
      const skillPath = resolve(import.meta.dirname, "../../skills/world-room/skill.json");
      const schema = JSON.parse(readFileSync(skillPath, "utf-8"));
      return { ok: true, skill: schema };
    }

    case "open-preview": {
      const a = args as { agentId?: string };
      const vitePort = process.env.VITE_PORT ?? "3000";
      const serverUrl = `http://127.0.0.1:${ctx.config.port}`;
      const url = a?.agentId
        ? `http://localhost:${vitePort}/?agent=${encodeURIComponent(a.agentId)}&server=${encodeURIComponent(serverUrl)}`
        : `http://localhost:${vitePort}/?server=${encodeURIComponent(serverUrl)}`;
      const { execFile } = await import("node:child_process");
      const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
      execFile(cmd, [url], (err) => { if (err) console.warn("[server] Failed to open browser:", err.message); });
      return { ok: true, url };
    }

    default:
      throw new Error(`Unknown command: ${command}`);
  }
}
