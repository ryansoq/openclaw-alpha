import type { AgentProfile } from "../../server/types.js";

export interface TelecomPanelAPI {
  updateAgents(profiles: AgentProfile[]): void;
}

interface RecentMessage {
  from: string;
  to: string;
  text: string;
  timestamp: number;
}

interface PlatformStats {
  ok: boolean;
  uptime: number;
  agents: { total: number; online: number };
  messages: { total: number; last24h: number };
  transactions: { broadcast: number; indexed: number };
  server: { startedAt: string; version: string };
}

/**
 * Telecom dashboard panel — left-side slide-in.
 * Shows online users, recent messages, platform stats.
 */
export function setupTelecomPanel(serverBaseUrl: string): TelecomPanelAPI {
  const apiBase = serverBaseUrl || "";
  let agents: AgentProfile[] = [];
  let visible = false;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;

  // ── Toggle via toolbar event ────────────────────────────────
  window.addEventListener("toolbar:telecom", () => {
    visible ? hide() : show();
  });

  // ── Panel container ───────────────────────────────────────
  const panel = document.createElement("div");
  panel.id = "telecom-panel";
  document.body.appendChild(panel);

  function show() {
    visible = true;
    panel.classList.add("visible");
    refresh();
    refreshTimer = setInterval(refresh, 15_000);
  }

  function hide() {
    visible = false;
    panel.classList.remove("visible");
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  }

  // ESC to close
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && visible) hide();
  });

  async function refresh() {
    const [stats, messages] = await Promise.all([
      fetchStats(),
      fetchRecentMessages(),
    ]);
    render(stats, messages);
  }

  async function fetchStats(): Promise<PlatformStats> {
    try {
      const r = await fetch(`${apiBase}/api/stats`);
      const d = await r.json();
      return d as PlatformStats;
    } catch {
      return { ok: false, uptime: 0, agents: { total: 0, online: 0 }, messages: { total: 0, last24h: 0 }, transactions: { broadcast: 0, indexed: 0 }, server: { startedAt: "", version: "0.1.0" } };
    }
  }

  async function fetchRecentMessages(): Promise<RecentMessage[]> {
    try {
      const r = await fetch(`${apiBase}/api/messages/recent?limit=20`);
      const d = await r.json();
      return d.messages ?? [];
    } catch {
      return [];
    }
  }

  function render(stats: PlatformStats, messages: RecentMessage[]) {
    panel.textContent = "";

    // Close button
    const closeBtn = document.createElement("button");
    closeBtn.className = "tp-close";
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", hide);
    panel.appendChild(closeBtn);

    // Title
    const title = document.createElement("div");
    title.className = "tp-title";
    title.textContent = "📡 Telecom Dashboard";
    panel.appendChild(title);

    // ── Stats section ─────────────────────────────────────
    const statsSection = document.createElement("div");
    statsSection.className = "tp-section";

    const statsTitle = document.createElement("div");
    statsTitle.className = "tp-section-title";
    statsTitle.textContent = "📊 Platform Stats";
    statsSection.appendChild(statsTitle);

    const statsGrid = document.createElement("div");
    statsGrid.className = "tp-stats-grid";

    const uptimeMin = Math.floor(stats.uptime / 60);
    const uptimeStr = uptimeMin < 60
      ? `${uptimeMin}m`
      : `${Math.floor(uptimeMin / 60)}h ${uptimeMin % 60}m`;

    const statItems = [
      { label: "Agents", value: `${stats.agents.online}/${stats.agents.total}`, icon: "👥" },
      { label: "Uptime", value: uptimeStr, icon: "⏱️" },
      { label: "Last 24h", value: String(stats.messages.last24h), icon: "💬" },
      { label: "Total Msgs", value: String(stats.messages.total), icon: "📨" },
      { label: "Broadcasts", value: String(stats.transactions.broadcast), icon: "📡" },
      { label: "Version", value: stats.server.version, icon: "🏷️" },
    ];
    for (const s of statItems) {
      const card = document.createElement("div");
      card.className = "tp-stat-card";
      card.innerHTML = `<div class="tp-stat-icon">${s.icon}</div><div class="tp-stat-value">${s.value}</div><div class="tp-stat-label">${s.label}</div>`;
      statsGrid.appendChild(card);
    }
    statsSection.appendChild(statsGrid);
    panel.appendChild(statsSection);

    // ── Online Users section ──────────────────────────────
    const usersSection = document.createElement("div");
    usersSection.className = "tp-section";

    const usersTitle = document.createElement("div");
    usersTitle.className = "tp-section-title";
    usersTitle.textContent = `📡 Agents (${agents.length})`;
    usersSection.appendChild(usersTitle);

    const usersList = document.createElement("div");
    usersList.className = "tp-users-list";

    const now = Date.now();
    const sortedAgents = [...agents].sort((a, b) => b.lastSeen - a.lastSeen);

    for (const a of sortedAgents) {
      const row = document.createElement("div");
      row.className = "tp-user-row";
      row.style.cursor = "pointer";

      const isOnline = (now - a.lastSeen) < 5 * 60 * 1000;
      const dot = isOnline ? "🟢" : "🔴";
      const addr = a.kaspaAddress
        ? `${a.kaspaAddress.slice(0, 10)}...${a.kaspaAddress.slice(-6)}`
        : "—";
      const lastSeen = new Date(a.lastSeen).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

      const dotEl = document.createElement("span");
      dotEl.className = "tp-user-dot";
      dotEl.textContent = dot;
      row.appendChild(dotEl);

      const nameEl = document.createElement("span");
      nameEl.className = "tp-user-name";
      nameEl.textContent = a.name;
      row.appendChild(nameEl);

      const addrEl = document.createElement("span");
      addrEl.className = "tp-user-addr";
      addrEl.textContent = addr;
      row.appendChild(addrEl);

      const timeEl = document.createElement("span");
      timeEl.className = "tp-user-time";
      timeEl.textContent = lastSeen;
      row.appendChild(timeEl);

      row.addEventListener("click", () => {
        window.dispatchEvent(
          new CustomEvent("agent:select", { detail: { agentId: a.agentId, profile: a } })
        );
      });

      usersList.appendChild(row);
    }

    if (agents.length === 0) {
      const empty = document.createElement("div");
      empty.className = "tp-empty";
      empty.textContent = "No agents registered";
      usersList.appendChild(empty);
    }

    usersSection.appendChild(usersList);
    panel.appendChild(usersSection);

    // ── Recent Messages section ───────────────────────────
    const msgSection = document.createElement("div");
    msgSection.className = "tp-section";

    const msgTitle = document.createElement("div");
    msgTitle.className = "tp-section-title";
    msgTitle.textContent = "💬 Recent Messages";
    msgSection.appendChild(msgTitle);

    const msgList = document.createElement("div");
    msgList.className = "tp-msg-list";

    if (messages.length === 0) {
      const empty = document.createElement("div");
      empty.className = "tp-empty";
      empty.textContent = "No messages yet";
      msgList.appendChild(empty);
    } else {
      for (const m of [...messages].reverse()) {
        const row = document.createElement("div");
        row.className = "tp-msg-row";

        const time = new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        const text = m.text.length > 60 ? m.text.slice(0, 60) + "…" : m.text;

        const flowEl = document.createElement("span");
        flowEl.className = "tp-msg-flow";
        flowEl.textContent = `${m.from} → ${m.to}`;
        row.appendChild(flowEl);

        const textEl = document.createElement("span");
        textEl.className = "tp-msg-text";
        textEl.textContent = text;
        row.appendChild(textEl);

        const timeEl = document.createElement("span");
        timeEl.className = "tp-msg-time";
        timeEl.textContent = time;
        row.appendChild(timeEl);

        msgList.appendChild(row);
      }
    }

    msgSection.appendChild(msgList);
    panel.appendChild(msgSection);
  }

  // Initial empty render
  render({ ok: false, uptime: 0, agents: { total: 0, online: 0 }, messages: { total: 0, last24h: 0 }, transactions: { broadcast: 0, indexed: 0 }, server: { startedAt: "", version: "0.1.0" } }, []);

  return {
    updateAgents(profiles: AgentProfile[]) {
      agents = profiles;
      if (visible) refresh();
    },
  };
}
