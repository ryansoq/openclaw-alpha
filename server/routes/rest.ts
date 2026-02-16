import type { IncomingMessage, ServerResponse } from "node:http";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import type { ServerContext } from "../context.js";
import { json, readBody, PayloadTooLargeError } from "../http-utils.js";
import { verifyTelegramAuth } from "../telegram-auth.js";
import type { ChatMessage, WhisperMessage } from "../types.js";

const execFile = promisify(execFileCb);

// ── Broadcast counter ────────────────────────────────────────
let broadcastCount = 0;
const serverStartedAt = new Date().toISOString();

// ── TX dedup set (防 Replay Attack) ──────────────────────────
const broadcastedTxIds = new Set<string>();
const TX_DEDUP_MAX = 10_000;
const TX_DEDUP_TRIM = 5_000;

function trackTxId(txId: string): boolean {
  if (broadcastedTxIds.has(txId)) return false; // duplicate
  broadcastedTxIds.add(txId);
  if (broadcastedTxIds.size > TX_DEDUP_MAX) {
    // Keep newest TX_DEDUP_TRIM entries
    const arr = [...broadcastedTxIds];
    broadcastedTxIds.clear();
    for (const id of arr.slice(-TX_DEDUP_TRIM)) broadcastedTxIds.add(id);
  }
  return true;
}

/** Return a safe error string (no file paths or stack traces) */
function sanitizeError(err: unknown): string {
  if (err instanceof PayloadTooLargeError) return "Payload too large";
  return "Internal server error";
}

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
    const agentLower = agent.toLowerCase();
    const allEvents = ctx.eventStore.query(since, 500);
    const mentions = allEvents
      .filter(e => e.worldType === "chat" && e.agentId !== agent && (e as ChatMessage).text.toLowerCase().includes(`@${agentLower}`))
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
      json(res, 502, { ok: false, error: "Could not reach moltbook.com" });
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
      json(res, 502, { ok: false, error: "Could not reach clawhub.ai" });
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
      const status = err instanceof PayloadTooLargeError ? 413 : 400; json(res, status, { ok: false, error: sanitizeError(err) });
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
      const status = err instanceof PayloadTooLargeError ? 413 : 400; json(res, status, { ok: false, error: sanitizeError(err) });
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
      const status = err instanceof PayloadTooLargeError ? 413 : 400; json(res, status, { ok: false, error: sanitizeError(err) });
    }
    return true;
  }

  if (url === "/api/clawhub/installed" && method === "GET") {
    json(res, 200, { ok: true, installed: ctx.clawhub.getInstalled() });
    return true;
  }

  // ── /api/auth/telegram — Telegram Login verification ───────
  if (url === "/api/auth/telegram" && method === "POST") {
    try {
      const body = (await readBody(req)) as Record<string, string>;
      const botToken = process.env.TG_BOT_TOKEN;
      if (!botToken) { json(res, 500, { ok: false, error: "TG_BOT_TOKEN not configured" }); return true; }

      const user = verifyTelegramAuth(body, botToken);
      if (!user) { json(res, 401, { ok: false, error: "Invalid or expired Telegram auth" }); return true; }

      // Register as a human agent
      const agentId = `tg_${user.id}`;
      const name = user.username
        ? `${user.first_name}(@${user.username})`
        : user.first_name;
      const profile = ctx.registry.register({
        agentId,
        name: `${name} 👤`,
        bio: "Human via Telegram Login",
        color: "#8B5CF6",
        avatar: user.photo_url,
        capabilities: ["human"],
      });

      const token = ctx.auth.issueToken(agentId);
      json(res, 200, {
        ok: true,
        profile,
        token,
        user: { id: user.id, name, username: user.username },
      });
    } catch (err) {
      const status = err instanceof PayloadTooLargeError ? 413 : 400; json(res, status, { ok: false, error: sanitizeError(err) });
    }
    return true;
  }

  // ── /api/auth/config — TG Login widget config (public) ────
  if (url === "/api/auth/config" && method === "GET") {
    const botUsername = process.env.TG_BOT_USERNAME ?? "";
    json(res, 200, { ok: true, botUsername, provider: "telegram" });
    return true;
  }

  // ── /api/dashboard — All dashboard widgets ─────────────────
  if (url === "/api/dashboard" && method === "GET") {
    json(res, 200, { ok: true, entries: ctx.dashboardStore.getAll(), widgets: ctx.dashboardStore.getAllWidgets() });
    return true;
  }

  // ── /api/screens — All screen content ─────────────────────
  if (url === "/api/screens" && method === "GET") {
    json(res, 200, { ok: true, screens: ctx.screenStore.getAll() });
    return true;
  }

  // ── /api/skill — Return SKILL.md for agent self-discovery ───
  if (url === "/api/skill" && method === "GET") {
    try {
      const { readFile } = await import("node:fs/promises");
      const { resolve } = await import("node:path");
      const skillPath = resolve(import.meta.dirname ?? ".", "../../skills/kaspa-telecom/SKILL.md");
      const content = await readFile(skillPath, "utf-8");
      res.writeHead(200, {
        "Content-Type": "text/markdown; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(content);
    } catch {
      json(res, 404, { error: "SKILL.md not found" });
    }
    return true;
  }

  // ── /api/messages/recent — Recent messages (all agents) ─────
  if (url.startsWith("/api/messages/recent") && method === "GET") {
    const reqUrl = new URL(req.url ?? "/", "http://localhost");
    const limit = Math.min(Number(reqUrl.searchParams.get("limit") || "20"), 100);
    const messages = ctx.messageStore.getRecent(limit);
    json(res, 200, { ok: true, messages });
    return true;
  }

  // ── /api/stats — Platform statistics ──────────────────────
  if (url === "/api/stats" && method === "GET") {
    const allProfiles = ctx.registry.getAll();
    const onlineAgents = ctx.registry.getOnline();
    json(res, 200, {
      ok: true,
      uptime: Math.floor(process.uptime()),
      agents: {
        total: allProfiles.length,
        online: onlineAgents.length,
      },
      messages: {
        total: ctx.messageStore.getTotal(),
        last24h: ctx.messageStore.getLast24h(),
      },
      transactions: {
        broadcast: broadcastCount,
        indexed: ctx.messageStore.getTotal(),
      },
      server: {
        startedAt: serverStartedAt,
        version: "0.1.0",
      },
    });
    return true;
  }

  // ── /api/directory — Public address book ────────────────────

  // POST /api/directory/register — External agent registration
  if (url === "/api/directory/register" && method === "POST") {
    try {
      const body = (await readBody(req)) as {
        name?: string; kaspaAddress?: string; bio?: string; skills?: string[];
      };
      if (!body.name || !body.kaspaAddress) {
        json(res, 400, { ok: false, error: "name and kaspaAddress required" });
        return true;
      }

      // Check if address already registered
      const existing = ctx.registry.getAll().find(p => p.kaspaAddress === body.kaspaAddress);
      if (existing) {
        json(res, 409, { ok: false, error: "Address already registered", agentId: existing.agentId });
        return true;
      }

      // Generate agentId from name slug
      const slug = body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      let agentId = slug || "agent";
      if (ctx.registry.get(agentId)) {
        agentId = `${slug}-${Date.now().toString(36)}`;
      }

      const profile = ctx.registry.register({
        agentId,
        name: body.name,
        kaspaAddress: body.kaspaAddress,
        bio: body.bio ?? "",
        skills: body.skills?.map(s => ({ skillId: s, name: s })),
      });

      const token = ctx.auth.issueToken(agentId);

      const pub = {
        agentId: profile.agentId, name: profile.name, bio: profile.bio,
        kaspaAddress: profile.kaspaAddress, skills: profile.skills,
        joinedAt: profile.joinedAt, lastSeen: profile.lastSeen,
      };
      json(res, 201, { ok: true, profile: pub, token });
    } catch (err) {
      const status = err instanceof PayloadTooLargeError ? 413 : 400; json(res, status, { ok: false, error: sanitizeError(err) });
    }
    return true;
  }

  // GET /api/directory — List public directory
  if (url.startsWith("/api/directory") && method === "GET") {
    const reqUrl = new URL(req.url ?? "/", "http://localhost");
    const path = reqUrl.pathname;

    // GET /api/directory/:address — Lookup by Kaspa address
    if (path.startsWith("/api/directory/")) {
      const address = decodeURIComponent(path.replace("/api/directory/", ""));
      const profile = ctx.registry.getAll().find(p => p.kaspaAddress === address);
      if (!profile) { json(res, 404, { ok: false, error: "Address not found" }); return true; }
      json(res, 200, {
        ok: true,
        profile: {
          agentId: profile.agentId, name: profile.name, bio: profile.bio,
          kaspaAddress: profile.kaspaAddress, skills: profile.skills,
          joinedAt: profile.joinedAt, lastSeen: profile.lastSeen,
        },
      });
      return true;
    }

    // GET /api/directory — List all
    const limit = Math.min(Number(reqUrl.searchParams.get("limit") || "50"), 200);
    const q = (reqUrl.searchParams.get("q") || "").toLowerCase();

    let agents = ctx.registry.getAll().filter(p => !!p.kaspaAddress);
    if (q) {
      agents = agents.filter(p =>
        p.name.toLowerCase().includes(q) || p.bio.toLowerCase().includes(q)
      );
    }

    const entries = agents.slice(0, limit).map(p => ({
      agentId: p.agentId, name: p.name, bio: p.bio,
      kaspaAddress: p.kaspaAddress, skills: p.skills,
      joinedAt: p.joinedAt, lastSeen: p.lastSeen,
    }));

    json(res, 200, { ok: true, entries, total: agents.length });
    return true;
  }

  // PUT /api/directory/:address — Update profile (auth required)
  if (url.startsWith("/api/directory/") && method === "PUT") {
    try {
      const address = decodeURIComponent(url.replace("/api/directory/", "").split("?")[0]);
      const profile = ctx.registry.getAll().find(p => p.kaspaAddress === address);
      if (!profile) { json(res, 404, { ok: false, error: "Address not found" }); return true; }

      const authHeader = req.headers.authorization ?? "";
      const token = authHeader.replace(/^Bearer\s+/i, "");
      if (!ctx.auth.validate(token, profile.agentId)) {
        json(res, 401, { ok: false, error: "Invalid or missing token" });
        return true;
      }

      const body = (await readBody(req)) as { name?: string; bio?: string; skills?: string[] };
      const updated = ctx.registry.register({
        agentId: profile.agentId,
        ...(body.name && { name: body.name }),
        ...(body.bio !== undefined && { bio: body.bio }),
        ...(body.skills && { skills: body.skills.map(s => ({ skillId: s, name: s })) }),
      });

      json(res, 200, {
        ok: true,
        profile: {
          agentId: updated.agentId, name: updated.name, bio: updated.bio,
          kaspaAddress: updated.kaspaAddress, skills: updated.skills,
          joinedAt: updated.joinedAt, lastSeen: updated.lastSeen,
        },
      });
    } catch (err) {
      const status = err instanceof PayloadTooLargeError ? 413 : 400; json(res, status, { ok: false, error: sanitizeError(err) });
    }
    return true;
  }

  // ── /api/contacts/:agentId — Get agent contacts ─────────────
  if (url.startsWith("/api/contacts/") && method === "GET") {
    const agentId = url.replace("/api/contacts/", "").split("?")[0];
    const profile = ctx.registry.get(agentId);
    if (!profile) { json(res, 404, { error: "Agent not found" }); return true; }
    json(res, 200, { ok: true, contacts: profile.contacts ?? [] }); return true;
  }

  // ── /api/messages/:address — Get messages for a Kaspa address ────
  if (url.startsWith("/api/messages/") && method === "GET") {
    const parts = url.split("/");
    const address = decodeURIComponent(parts[3]?.split("?")[0] ?? "");
    if (!address) { json(res, 400, { ok: false, error: "address required" }); return true; }

    const reqUrl = new URL(req.url ?? "/", "http://localhost");
    const limit = Math.min(Number(reqUrl.searchParams.get("limit") || "50"), 200);
    const since = Number(reqUrl.searchParams.get("since") || "0");

    const messages = ctx.messageStore.getForAddress(address, limit, since);
    json(res, 200, { ok: true, messages });
    return true;
  }

  // ── /api/utxos/:address — Get UTXOs for TX building ────────
  if (url.startsWith("/api/utxos/") && method === "GET") {
    try {
      const address = decodeURIComponent(url.replace("/api/utxos/", "").split("?")[0]);
      if (!address || !/^kaspa(test)?:[a-z0-9]{61,63}$/.test(address)) {
        json(res, 400, { ok: false, error: "Invalid or missing address" }); return true;
      }

      const reqUrl = new URL(req.url ?? "/", "http://localhost");
      const network = reqUrl.searchParams.get("network") || "testnet";
      if (!["testnet", "mainnet"].includes(network)) {
        json(res, 400, { ok: false, error: "Invalid network (testnet or mainnet)" }); return true;
      }

      const scriptPath = new URL(
        "../../skills/kaspa-telecom/scripts/get_utxos.py",
        import.meta.url
      ).pathname;

      const { stdout } = await execFile(
        "python3", [scriptPath, address, "--network", network],
        { timeout: 30_000, encoding: "utf-8", maxBuffer: 50 * 1024 * 1024 }
      );
      const parsed = JSON.parse(stdout.trim());

      if (parsed.success) {
        console.log(`[utxos] ${address}: ${parsed.utxo_count} UTXOs`);
        json(res, 200, { ok: true, ...parsed });
      } else {
        json(res, 400, { ok: false, error: parsed.error });
      }
    } catch (err) {
      json(res, 500, { ok: false, error: "UTXO query error" });
    }
    return true;
  }

  // ── /api/broadcast — Relay signed TX to Kaspa network ──────
  // Accepts: {signedTx: "hex"} or {transaction: {...dict}} or {signed_txs: [{...}]}
  if (url === "/api/broadcast" && method === "POST") {
    try {
      const body = (await readBody(req)) as Record<string, unknown>;
      const txData = body.signedTx || body.transaction || body.signed_txs || body.tx;
      if (!txData) {
        json(res, 400, { ok: false, error: "Provide signedTx (hex), transaction (dict), or signed_txs (array)" });
        return true;
      }

      const network = (body.network as string) || "testnet";
      if (!["testnet", "mainnet"].includes(network)) {
        json(res, 400, { ok: false, error: "Invalid network (testnet or mainnet)" }); return true;
      }

      // Pre-check: if client provides tx_id, dedup early
      if (body.tx_id && !trackTxId(body.tx_id as string)) {
        json(res, 409, { ok: false, error: "TX already broadcast" });
        return true;
      }

      // Broadcast via local kaspad RPC first (most reliable), REST API fallback
      const signedTxs = body.signed_txs as any[];
      if (!signedTxs?.length) {
        json(res, 400, { ok: false, error: "No signed_txs provided" }); return true;
      }
      const tx = signedTxs[0];
      console.log(`[broadcast] TX ${tx.id || "?"}, ${signedTxs.length} tx(s), network=${network}`);

      // Try 1: Local kaspad via broadcast_tx.py (reconstruct + direct RPC)
      // Write to temp file instead of stdin — execFile stdin breaks Python asyncio WebSocket
      const scriptPath = new URL("../../skills/kaspa-telecom/scripts/broadcast_tx.py", import.meta.url).pathname;
      const tmpFile = `/tmp/broadcast_${Date.now()}.json`;
      const { writeFile, unlink } = await import("node:fs/promises");
      await writeFile(tmpFile, JSON.stringify(body));
      try {
        const result = await execFile(
          "python3", [scriptPath, "--input", tmpFile],
          { timeout: 15_000, encoding: "utf-8" }
        );
        await unlink(tmpFile).catch(() => {});
        const parsed = JSON.parse(result.stdout.trim());
        if (parsed.success) {
          const txId = typeof parsed.tx_id === "string" ? parsed.tx_id : JSON.stringify(parsed.tx_id);
          trackTxId(txId);
          broadcastCount++;
          console.log(`[broadcast] TX relayed via local RPC: ${txId} (${network})`);
          json(res, 200, { ok: true, tx_id: txId, network });
        } else {
          throw new Error(parsed.error || "Local RPC failed");
        }
      } catch (localErr: unknown) {
        await unlink(tmpFile).catch(() => {});
        const le = localErr as { stdout?: string; stderr?: string; message?: string };
        console.error(`[broadcast] Local RPC failed:`, le.message?.slice(0, 100));
        // Parse stdout for JSON error if available
        let localError = "";
        try { localError = JSON.parse(le.stdout?.trim() || "{}").error || ""; } catch {}

        // Try 2: Kaspa REST API fallback
        console.log(`[broadcast] Trying REST API fallback...`);
        try {
          const restTx: any = {
            version: tx.version ?? 0,
            inputs: (tx.inputs || []).map((inp: any) => ({
              previousOutpoint: inp.previousOutpoint || { transactionId: inp.transactionId, index: inp.index ?? 0 },
              signatureScript: inp.signatureScript || "",
              sequence: inp.sequence ?? 0,
              sigOpCount: inp.sigOpCount ?? 1,
            })),
            outputs: (tx.outputs || []).map((out: any) => {
              const spk = out.scriptPublicKey;
              let version = 0, script = "";
              if (typeof spk === "object") { version = spk.version ?? 0; script = spk.scriptPublicKey || spk.script || ""; }
              else if (typeof spk === "string" && spk.length > 4) { version = parseInt(spk.slice(0, 4), 16); script = spk.slice(4); }
              return { amount: out.value ?? out.amount ?? 0, scriptPublicKey: { version, scriptPublicKey: script } };
            }),
            lockTime: tx.lockTime ?? 0,
            subnetworkId: tx.subnetworkId || "0000000000000000000000000000000000000000",
            payload: tx.payload || "", gas: tx.gas ?? 0,
          };
          const restApiBase = network === "mainnet" ? "https://api.kaspa.org" : "https://api-tn10.kaspa.org";
          const resp = await fetch(`${restApiBase}/transactions`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ transaction: restTx, allowOrphan: false }),
            signal: AbortSignal.timeout(15_000),
          });
          const respText = await resp.text();
          if (resp.ok) {
            let txId = tx.id || "";
            try { txId = JSON.parse(respText)?.transactionId || txId; } catch {}
            trackTxId(txId);
            broadcastCount++;
            console.log(`[broadcast] TX relayed via REST: ${txId} (${network})`);
            json(res, 200, { ok: true, tx_id: txId, network });
          } else {
            console.error(`[broadcast] REST API also failed: ${respText.slice(0, 200)}`);
            json(res, 400, { ok: false, error: localError || `Broadcast failed: ${respText.slice(0, 200)}` });
          }
        } catch (restErr) {
          json(res, 400, { ok: false, error: localError || "Both local RPC and REST API failed" });
        }
      }
    } catch (err) {
      console.error(`[broadcast] Error:`, err instanceof Error ? err.message : String(err));
      if (err instanceof PayloadTooLargeError) {
        json(res, 413, { ok: false, error: "Payload too large" });
      } else {
        json(res, 500, { ok: false, error: "Broadcast error" });
      }
    }
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
