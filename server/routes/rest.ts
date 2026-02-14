import type { IncomingMessage, ServerResponse } from "node:http";
import type { ServerContext } from "../context.js";
import { json, readBody } from "../http-utils.js";

/**
 * Handle REST API routes. Returns true if handled, false if not matched.
 */
export async function handleRestRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): Promise<boolean> {
  const url = req.url ?? "/";
  const method = req.method ?? "GET";

  // ── /api/events — Chat history ────────────────────────────
  if (url.startsWith("/api/events") && method === "GET") {
    const reqUrl = new URL(req.url ?? "/", "http://localhost");
    const since = Number(reqUrl.searchParams.get("since") || "0");
    const limit = Math.min(Number(reqUrl.searchParams.get("limit") || "50"), 200);
    json(res, 200, { ok: true, events: ctx.eventStore.query(since, limit) });
    return true;
  }

  // ── /api/mentions — Unread @mentions for an agent ─────────
  if (url.startsWith("/api/mentions") && method === "GET") {
    const reqUrl = new URL(req.url ?? "/", "http://localhost");
    const agent = reqUrl.searchParams.get("agent");
    if (!agent) { json(res, 400, { ok: false, error: "agent param required" }); return true; }
    const since = Number(reqUrl.searchParams.get("since") || "0");
    const limit = Math.min(Number(reqUrl.searchParams.get("limit") || "20"), 100);
    const pattern = new RegExp(`@${agent}\\b`, "i");
    const allEvents = ctx.eventStore.query(since, 500);
    const mentions = allEvents
      .filter(e => e.worldType === "chat" && e.agentId !== agent && pattern.test((e as any).text ?? ""))
      .slice(-limit);
    json(res, 200, { ok: true, agent, mentions, count: mentions.length });
    return true;
  }

  // ── /api/room — Room info ─────────────────────────────────
  if (url === "/api/room" && method === "GET") {
    json(res, 200, { ok: true, ...ctx.getRoomInfo() });
    return true;
  }

  // ── /api/invite — Room invite for Nostr sharing ───────────
  if (url === "/api/invite" && method === "GET") {
    const info = ctx.getRoomInfo();
    json(res, 200, {
      ok: true,
      invite: {
        roomId: info.roomId,
        name: info.name,
        relays: ctx.nostr.getRelays(),
        channelId: ctx.nostr.getChannelId(),
        agents: info.agents,
        maxAgents: info.maxAgents,
      },
    });
    return true;
  }

  // ── /api/moltbook/feed — Proxy to moltbook.com ────────────
  if (url.startsWith("/api/moltbook/feed") && method === "GET") {
    try {
      const feedUrl = "https://www.moltbook.com/posts?sort=hot&limit=20";
      const headers: Record<string, string> = { Accept: "application/json" };
      const moltbookKey = process.env.MOLTBOOK_API_KEY;
      if (moltbookKey) headers["Authorization"] = `Bearer ${moltbookKey}`;
      const upstream = await fetch(feedUrl, { headers, signal: AbortSignal.timeout(8000) });
      if (!upstream.ok) { json(res, 502, { ok: false, error: `moltbook.com returned ${upstream.status}` }); return true; }
      const data = await upstream.json();
      json(res, 200, { ok: true, posts: data });
    } catch (err) {
      json(res, 502, { ok: false, error: `Could not reach moltbook.com: ${String(err)}` });
    }
    return true;
  }

  // ── /api/clawhub/browse — Proxy to clawhub.ai ────────────
  if (url.startsWith("/api/clawhub/browse") && method === "GET") {
    try {
      const reqUrl = new URL(req.url ?? "/", "http://localhost");
      const sort = reqUrl.searchParams.get("sort") || "trending";
      const query = reqUrl.searchParams.get("q") || "";
      const limit = reqUrl.searchParams.get("limit") || "50";
      const upstream = query
        ? `https://clawhub.ai/api/v1/search?q=${encodeURIComponent(query)}&limit=${limit}`
        : `https://clawhub.ai/api/v1/skills?sort=${encodeURIComponent(sort)}&limit=${limit}`;
      const response = await fetch(upstream, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
      if (!response.ok) { json(res, 502, { ok: false, error: `clawhub.ai returned ${response.status}` }); return true; }
      const data = await response.json();
      json(res, 200, { ok: true, data });
    } catch (err) {
      json(res, 502, { ok: false, error: `Could not reach clawhub.ai: ${String(err)}` });
    }
    return true;
  }

  // ── /api/clawhub/skills — Local plugin store ──────────────
  if (url === "/api/clawhub/skills" && method === "GET") {
    json(res, 200, { ok: true, skills: ctx.clawhub.list() });
    return true;
  }

  if (url === "/api/clawhub/skills" && method === "POST") {
    try {
      const body = (await readBody(req)) as {
        id?: string; name?: string; description?: string;
        author?: string; version?: string; tags?: string[];
      };
      if (!body.id || !body.name) { json(res, 400, { ok: false, error: "id and name required" }); return true; }
      const skill = ctx.clawhub.publish({
        id: body.id, name: body.name, description: body.description ?? "",
        author: body.author ?? "unknown", version: body.version ?? "0.1.0", tags: body.tags ?? [],
      });
      json(res, 201, { ok: true, skill });
    } catch (err) {
      json(res, 400, { ok: false, error: String(err) });
    }
    return true;
  }

  if (url === "/api/clawhub/install" && method === "POST") {
    try {
      const body = (await readBody(req)) as { skillId?: string };
      if (!body.skillId) { json(res, 400, { ok: false, error: "skillId required" }); return true; }
      const record = ctx.clawhub.install(body.skillId);
      if (!record) { json(res, 404, { ok: false, error: "skill not found" }); return true; }
      json(res, 200, { ok: true, installed: record });
    } catch (err) {
      json(res, 400, { ok: false, error: String(err) });
    }
    return true;
  }

  if (url === "/api/clawhub/uninstall" && method === "POST") {
    try {
      const body = (await readBody(req)) as { skillId?: string };
      if (!body.skillId) { json(res, 400, { ok: false, error: "skillId required" }); return true; }
      const ok = ctx.clawhub.uninstall(body.skillId);
      json(res, ok ? 200 : 404, { ok });
    } catch (err) {
      json(res, 400, { ok: false, error: String(err) });
    }
    return true;
  }

  if (url === "/api/clawhub/installed" && method === "GET") {
    json(res, 200, { ok: true, installed: ctx.clawhub.getInstalled() });
    return true;
  }

  // ── /health — Server health check ─────────────────────────
  if (method === "GET" && url === "/health") {
    json(res, 200, {
      status: "ok",
      roomId: ctx.config.roomId,
      agents: ctx.registry.getOnline().length,
      clients: ctx.clientManager.size,
      tick: ctx.gameLoop.currentTick,
    });
    return true;
  }

  return false;
}
