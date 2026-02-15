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

    // Input row
    const inputRow = document.createElement("div");
    inputRow.className = "agent-chat-input-row";

    const input = document.createElement("input");
    input.className = "agent-chat-input";
    input.type = "text";
    input.placeholder = "Type a message...";
    input.maxLength = 500;
    inputRow.appendChild(input);

    const sendBtn = document.createElement("button");
    sendBtn.className = "agent-chat-send-btn";
    sendBtn.textContent = "Send";
    inputRow.appendChild(sendBtn);

    panel.appendChild(inputRow);

    // Send handler
    const doSend = async () => {
      const text = input.value.trim();
      if (!text || !currentTarget) return;
      input.value = "";
      sendBtn.disabled = true;
      sendBtn.textContent = "Sending...";
      try {
        await fetch(`${serverUrl}/api/messages/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ from: currentMyId, to: currentTarget.agentId, text }),
        });
        await loadMessages();
      } catch (err) {
        console.error("[agent-chat] Send failed:", err);
      } finally {
        sendBtn.disabled = false;
        sendBtn.textContent = "Send";
      }
    };

    sendBtn.addEventListener("click", doSend);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        doSend();
      }
    });

    // Load initial messages
    loadMessages();
  }

  async function loadMessages(): Promise<void> {
    if (!currentTarget) return;
    const container = document.getElementById("agent-chat-messages");
    if (!container) return;

    try {
      const url = `${serverUrl}/api/messages/${encodeURIComponent(currentMyId)}?with=${encodeURIComponent(currentTarget.agentId)}&limit=50`;
      const resp = await fetch(url);
      const data = await resp.json();

      if (!data.ok) throw new Error(data.error);

      container.textContent = "";
      const messages = data.messages as ChatMessage[];

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

        const textEl = document.createElement("div");
        textEl.className = "agent-chat-text";
        textEl.textContent = msg.text;
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

  return {
    open,
    close,
    isOpen: () => visible,
  };
}
