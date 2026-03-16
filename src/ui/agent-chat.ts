import type { AgentProfile } from "../../server/types.js";

interface ChatMessage {
  id: string;
  from: string;
  to: string;
  text: string;
  timestamp: number;
  status: string;
}

export interface AgentChatAPI {
  open(myAgentId: string, target: AgentProfile): void;
  close(): void;
  isOpen(): boolean;
}

/**
 * Agent DM overlay — Kaspa on-chain messaging chat window.
 * Uses the building-overlay container (same as PR board, moltbook, etc.)
 */
export function setupAgentChat(serverUrl: string): AgentChatAPI {
  const overlay = document.getElementById("building-overlay")!;
  const panel = overlay.querySelector(".building-panel") as HTMLElement;

  let visible = false;
  let currentMyId = "";
  let currentTarget: AgentProfile | null = null;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;

  function close(): void {
    overlay.classList.remove("visible");
    visible = false;
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }

  function open(myAgentId: string, target: AgentProfile): void {
    currentMyId = myAgentId;
    currentTarget = target;
    render();
    overlay.classList.add("visible");
    visible = true;

    // Auto-refresh messages every 5s
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => loadMessages(), 5000);
  }

  function render(): void {
    if (!currentTarget) return;
    panel.textContent = "";
    panel.className = "building-panel agent-chat-panel";

    // Header
    const header = document.createElement("div");
    header.className = "bp-header";

    const title = document.createElement("h2");
    title.textContent = `💬 Chat with ${currentTarget.name}`;
    header.appendChild(title);

    if (currentTarget.kaspaAddress) {
      const addrEl = document.createElement("p");
      addrEl.className = "bp-subtitle agent-chat-addr";
      addrEl.textContent = `Kaspa: ${currentTarget.kaspaAddress.slice(0, 20)}...${currentTarget.kaspaAddress.slice(-8)}`;
      addrEl.title = currentTarget.kaspaAddress;
      header.appendChild(addrEl);
    } else {
      const noAddr = document.createElement("p");
      noAddr.className = "bp-subtitle";
      noAddr.textContent = "⚠️ No Kaspa address registered (messages are mocked)";
      header.appendChild(noAddr);
    }

    const closeBtn = document.createElement("button");
    closeBtn.className = "bp-close";
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", close);
    header.appendChild(closeBtn);

    panel.appendChild(header);

    // Messages container
    const messagesEl = document.createElement("div");
    messagesEl.className = "agent-chat-messages";
    messagesEl.id = "agent-chat-messages";
    const loading = document.createElement("div");
    loading.className = "bp-loading";
    loading.textContent = "Loading messages...";
    messagesEl.appendChild(loading);
    panel.appendChild(messagesEl);

    // Input area
    const inputArea = document.createElement("div");
    inputArea.className = "agent-chat-input-row";

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "輸入訊息...";
    input.className = "agent-chat-input";

    const sendBtn = document.createElement("button");
    sendBtn.textContent = "送出";
    sendBtn.className = "agent-chat-send-btn";

    const doSend = async () => {
      const text = input.value.trim();
      if (!text || !currentTarget) return;
      input.value = "";
      try {
        const token = localStorage.getItem("oc_token") || "";
        await fetch(`${serverUrl}/api/dm/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ from: currentMyId, to: currentTarget.agentId, text }),
        });
        loadMessages();
      } catch { /* ignore */ }
    };
    sendBtn.addEventListener("click", doSend);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") doSend(); });
    inputArea.appendChild(input);
    inputArea.appendChild(sendBtn);
    panel.appendChild(inputArea);

    // Load initial messages
    loadMessages();
  }

  async function loadMessages(): Promise<void> {
    if (!currentTarget) return;
    const container = document.getElementById("agent-chat-messages");
    if (!container) return;

    try {
      const url = `${serverUrl}/api/dm/conversation/${encodeURIComponent(currentTarget.agentId)}?agent=${encodeURIComponent(currentMyId)}&limit=50`;
      const resp = await fetch(url);
      const data = await resp.json();

      if (!data.ok) throw new Error(data.error);

      container.textContent = "";
      const messages = (data.messages || []) as ChatMessage[];

      if (messages.length === 0) {
        const empty = document.createElement("div");
        empty.className = "bp-empty";
        empty.textContent = "No messages yet. Send the first one! 🚀";
        container.appendChild(empty);
        return;
      }

      for (const msg of messages) {
        const bubble = document.createElement("div");
        const isMe = msg.from === currentMyId;
        bubble.className = `agent-chat-bubble ${isMe ? "agent-chat-mine" : "agent-chat-theirs"}`;

        const senderEl = document.createElement("div");
        senderEl.className = "agent-chat-sender";
        senderEl.textContent = msg.from;
        bubble.appendChild(senderEl);

        const textEl = document.createElement("div");
        textEl.className = "agent-chat-text";
        textEl.textContent = (msg as any).encrypted ? "🔒 加密訊息" : msg.text;
        bubble.appendChild(textEl);

        const metaEl = document.createElement("div");
        metaEl.className = "agent-chat-meta";
        const time = new Date(msg.timestamp).toLocaleTimeString();
        const statusIcon = msg.status === "confirmed" ? "✅" : msg.status === "sent" ? "📤" : msg.status === "failed" ? "❌" : "⏳";
        metaEl.textContent = `${time} ${isMe ? statusIcon : ""}`;
        bubble.appendChild(metaEl);

        container.appendChild(bubble);
      }

      // Scroll to bottom
      container.scrollTop = container.scrollHeight;
    } catch (err) {
      container.textContent = "";
      const errEl = document.createElement("div");
      errEl.className = "bp-error";
      errEl.textContent = "Could not load messages.";
      container.appendChild(errEl);
    }
  }

  // Listen for real-time WebSocket messages
  function connectWs(): void {
    try {
      const wsUrl = serverUrl.replace(/^http/, "ws") + "/ws";
      const ws = new WebSocket(wsUrl);
      ws.addEventListener("message", (ev) => {
        try {
          const data = JSON.parse(ev.data as string);
          if (data.type === "newMessage" && visible && currentTarget) {
            // Refresh if the message involves current conversation
            const e = data.event;
            if (
              (e?.from === currentMyId && data.agentId === currentTarget.agentId) ||
              (e?.from === currentTarget.agentId && data.agentId === currentMyId)
            ) {
              loadMessages();
            }
          }
        } catch { /* ignore */ }
      });
      ws.addEventListener("close", () => {
        // Reconnect after 5s
        setTimeout(connectWs, 5000);
      });
    } catch { /* WS not available, polling still works */ }
  }
  connectWs();

  return {
    open,
    close,
    isOpen: () => visible,
  };
}
