/**
 * PR Board Panel — shows open GitHub PRs when clicking the PR board.
 * Fetches from server's pr-list IPC endpoint.
 */

interface PullRequest {
  number: number;
  title: string;
  author: string;
  url: string;
  status: "open" | "review" | "approved" | "changes-requested" | "draft";
  reviewers: string[];
  createdAt: string;
  updatedAt: string;
  stalled: boolean;
}

const STATUS_EMOJI: Record<string, string> = {
  open: "🟢",
  review: "👀",
  approved: "✅",
  "changes-requested": "🔄",
  draft: "📝",
};

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  review: "In Review",
  approved: "Approved",
  "changes-requested": "Changes Requested",
  draft: "Draft",
};

export interface PRBoardAPI {
  show(): void;
  hide(): void;
  isVisible(): boolean;
}

export function setupPRBoard(serverUrl: string): PRBoardAPI {
  const overlay = document.getElementById("building-overlay")!;
  const panel = overlay.querySelector(".building-panel") as HTMLElement;

  let visible = false;

  function hide(): void {
    overlay.classList.remove("visible");
    visible = false;
  }

  function show(): void {
    panel.textContent = "";
    panel.className = "building-panel pr-board-panel";

    // Header
    const header = document.createElement("div");
    header.className = "bp-header";

    const title = document.createElement("h2");
    title.textContent = "🔀 PR Board";
    header.appendChild(title);

    const subtitle = document.createElement("p");
    subtitle.className = "bp-subtitle";
    subtitle.textContent = "Open pull requests — ryansoq/openclaw-alpha";
    header.appendChild(subtitle);

    const closeBtn = document.createElement("button");
    closeBtn.className = "bp-close";
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", hide);
    header.appendChild(closeBtn);

    panel.appendChild(header);

    // PR list container
    const list = document.createElement("div");
    list.className = "pr-board-list";
    const loading = document.createElement("div");
    loading.className = "bp-loading";
    loading.textContent = "Loading PRs from GitHub...";
    list.appendChild(loading);
    panel.appendChild(list);

    // Legend
    const legend = document.createElement("div");
    legend.className = "pr-board-legend";
    legend.innerHTML = `<span>🟢 Open</span><span>👀 Review</span><span>✅ Approved</span><span>🔄 Changes</span><span>📝 Draft</span><span>⚠️ Stalled (>24h)</span>`;
    panel.appendChild(legend);

    loadPRs(list);

    overlay.classList.add("visible");
    visible = true;
  }

  async function loadPRs(list: HTMLElement): Promise<void> {
    try {
      const res = await fetch(`${serverUrl}/ipc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "pr-list" }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed");

      list.textContent = "";
      const prs = data.prs as PullRequest[];

      if (prs.length === 0) {
        const empty = document.createElement("div");
        empty.className = "bp-empty";
        empty.textContent = "No open PRs 🎉";
        list.appendChild(empty);
        return;
      }

      for (const pr of prs) {
        list.appendChild(createPRCard(pr));
      }
    } catch {
      list.textContent = "";
      const err = document.createElement("div");
      err.className = "bp-error";
      err.textContent = "Could not load PRs. Is gh CLI configured?";
      list.appendChild(err);
    }
  }

  function createPRCard(pr: PullRequest): HTMLElement {
    const card = document.createElement("div");
    card.className = "pr-card" + (pr.stalled ? " pr-stalled" : "");
    card.style.cursor = "pointer";
    card.addEventListener("click", () => window.open(pr.url, "_blank", "noopener"));

    // Top row: status + title + number
    const top = document.createElement("div");
    top.className = "pr-card-top";
    top.innerHTML = `<span class="pr-status">${STATUS_EMOJI[pr.status] ?? "🟢"}</span>
      <span class="pr-title">${esc(pr.title)}</span>
      <span class="pr-number">#${pr.number}</span>`;
    if (pr.stalled) top.innerHTML += `<span class="pr-stalled-badge">⚠️ stalled</span>`;
    card.appendChild(top);

    // Meta row
    const meta = document.createElement("div");
    meta.className = "pr-card-meta";
    const parts: string[] = [
      `by ${esc(pr.author)}`,
      STATUS_LABEL[pr.status] ?? pr.status,
    ];
    if (pr.reviewers.length) parts.push(`reviewers: ${pr.reviewers.map(esc).join(", ")}`);
    parts.push(`opened ${timeAgo(pr.createdAt)}`);
    if (pr.updatedAt !== pr.createdAt) parts.push(`updated ${timeAgo(pr.updatedAt)}`);
    meta.textContent = parts.join(" · ");
    card.appendChild(meta);

    return card;
  }

  function timeAgo(iso: string): string {
    const ms = Date.now() - new Date(iso).getTime();
    const h = Math.floor(ms / 3600000);
    if (h < 1) return `${Math.floor(ms / 60000)}m ago`;
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  function esc(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  return { show, hide, isVisible: () => visible };
}
