import type { AgentProfile } from "../../server/types.js";

interface ProfilePanelAPI {
  show(profile: AgentProfile): void;
  hide(): void;
  onSendMessage(handler: (profile: AgentProfile) => void): void;
  onContactClick(handler: (ownerAgentId: string, contact: { name: string; kaspaAddress: string }) => void): void;
}

/**
 * Open a conversation overlay showing chat history with a target agent.
 */
function openConversation(myId: string, targetId: string, targetName: string, token: string): void {
  // Remove existing overlay
  document.getElementById("dm-conversation")?.remove();

  const overlay = document.createElement("div");
  overlay.id = "dm-conversation";
  overlay.style.cssText = "position:fixed;top:0;right:0;width:380px;height:100%;background:rgba(255,255,255,0.97);z-index:1100;display:flex;flex-direction:column;box-shadow:-4px 0 24px rgba(0,0,0,0.12);border-left:1px solid rgba(0,0,0,0.08);";

  // Header
  const header = document.createElement("div");
  header.style.cssText = "padding:16px 20px;border-bottom:1px solid rgba(0,0,0,0.06);display:flex;align-items:center;gap:12px;";
  const backBtn = document.createElement("button");
  backBtn.textContent = "←";
  backBtn.style.cssText = "background:none;border:none;color:#49a078;font-size:20px;cursor:pointer;padding:0;";
  backBtn.addEventListener("click", () => overlay.remove());
  header.appendChild(backBtn);
  const title = document.createElement("span");
  title.textContent = `💬 ${targetName}`;
  title.style.cssText = "color:#2c3e50;font-size:15px;font-weight:600;";
  header.appendChild(title);
  overlay.appendChild(header);

  // Messages area
  const msgArea = document.createElement("div");
  msgArea.style.cssText = "flex:1;overflow-y:auto;padding:12px 16px;display:flex;flex-direction:column;gap:8px;";
  const loadingMsg = document.createElement("div");
  loadingMsg.textContent = "載入中...";
  loadingMsg.style.cssText = "color:#95a5a6;text-align:center;padding:20px;font-size:13px;";
  msgArea.appendChild(loadingMsg);
  overlay.appendChild(msgArea);

  // Input area
  const inputArea = document.createElement("div");
  inputArea.style.cssText = "padding:12px 16px;border-top:1px solid rgba(0,0,0,0.06);display:flex;gap:8px;";
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "輸入訊息...";
  input.className = "agent-chat-input";
  const sendBtn = document.createElement("button");
  sendBtn.textContent = "送出";
  sendBtn.className = "agent-chat-send-btn";

  const doSend = () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    fetch("/api/dm/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: myId, to: targetId, text }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.ok) {
          const bubble = createBubble(data.message, myId);
          msgArea.appendChild(bubble);
          msgArea.scrollTop = msgArea.scrollHeight;
        }
      });
  };
  sendBtn.addEventListener("click", doSend);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") doSend(); });
  inputArea.appendChild(input);
  inputArea.appendChild(sendBtn);
  overlay.appendChild(inputArea);

  document.body.appendChild(overlay);
  input.focus();

  // Load conversation
  fetch(`/api/dm/conversation/${targetId}?agent=${myId}&limit=50`)
    .then(r => r.json())
    .then(data => {
      msgArea.textContent = "";
      const messages = data.ok ? data.messages : [];
      if (messages.length === 0) {
        const empty = document.createElement("div");
        empty.textContent = "開始聊天吧！";
        empty.style.cssText = "color:#888;text-align:center;padding:40px;";
        msgArea.appendChild(empty);
      } else {
        for (const m of messages) {
          msgArea.appendChild(createBubble(m, myId));
        }
        msgArea.scrollTop = msgArea.scrollHeight;
      }
      // Mark as read
      fetch("/api/dm/read", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ agent: myId, from: targetId }),
      }).catch(() => {});
    })
    .catch(() => {
      msgArea.textContent = "";
      const err = document.createElement("div");
      err.textContent = "無法載入對話";
      err.style.cssText = "color:#e74c3c;text-align:center;padding:20px;";
      msgArea.appendChild(err);
    });
}

function createBubble(msg: { from: string; text: string; timestamp: number; encrypted?: boolean }, myId: string): HTMLElement {
  const isMe = msg.from === myId;
  const bubble = document.createElement("div");
  bubble.className = `agent-chat-bubble ${isMe ? "agent-chat-mine" : "agent-chat-theirs"}`;

  const textEl = document.createElement("div");
  textEl.className = "agent-chat-text";
  textEl.textContent = msg.encrypted ? "🔒 加密訊息" : msg.text;
  bubble.appendChild(textEl);

  const timeEl = document.createElement("div");
  timeEl.className = "agent-chat-meta";
  timeEl.textContent = new Date(msg.timestamp).toLocaleTimeString();
  bubble.appendChild(timeEl);

  return bubble;
}

/**
 * Slide-in profile panel (right side).
 * Click a lobster → shows agent details.
 */
export function setupProfilePanel(
  onFocusAgent: (agentId: string) => void
): ProfilePanelAPI {
  const container = document.getElementById("profile-panel")!;
  let currentProfile: AgentProfile | null = null;
  let sendMessageHandler: ((profile: AgentProfile) => void) | null = null;
  let contactClickHandler: ((ownerAgentId: string, contact: { name: string; kaspaAddress: string }) => void) | null = null;

  function render(profile: AgentProfile): void {
    // Clear previous content safely
    container.textContent = "";

    // Close button
    const closeBtn = document.createElement("button");
    closeBtn.className = "profile-close";
    closeBtn.textContent = "\u00d7";
    closeBtn.addEventListener("click", () => hide());
    container.appendChild(closeBtn);

    // Color swatch + name
    const headerEl = document.createElement("div");
    headerEl.className = "profile-header";

    const swatchEl = document.createElement("div");
    swatchEl.className = "profile-swatch";
    swatchEl.style.background = profile.color;
    headerEl.appendChild(swatchEl);

    const nameEl = document.createElement("h2");
    nameEl.className = "profile-name";
    nameEl.textContent = profile.name;
    headerEl.appendChild(nameEl);

    container.appendChild(headerEl);

    // Agent ID
    const idEl = document.createElement("div");
    idEl.className = "profile-id";
    idEl.textContent = `ID: ${profile.agentId}`;
    container.appendChild(idEl);

    // Pubkey (truncated)
    if (profile.pubkey) {
      const pkEl = document.createElement("div");
      pkEl.className = "profile-pubkey";
      pkEl.textContent = `Pubkey: ${profile.pubkey.slice(0, 16)}...`;
      container.appendChild(pkEl);
    }

    // Kaspa Address
    if (profile.kaspaAddress) {
      const kaspaLabel = document.createElement("div");
      kaspaLabel.className = "profile-label";
      kaspaLabel.textContent = "Kaspa Address";
      container.appendChild(kaspaLabel);

      const kaspaEl = document.createElement("div");
      kaspaEl.className = "profile-kaspa-addr";
      const addr = profile.kaspaAddress;
      kaspaEl.textContent = `${addr.slice(0, 16)}...${addr.slice(-8)}`;
      kaspaEl.title = addr;
      kaspaEl.style.cursor = "pointer";
      kaspaEl.addEventListener("click", () => {
        navigator.clipboard.writeText(addr).catch(() => {});
        kaspaEl.textContent = "Copied!";
        setTimeout(() => {
          kaspaEl.textContent = `${addr.slice(0, 16)}...${addr.slice(-8)}`;
        }, 1500);
      });
      container.appendChild(kaspaEl);
    }

    // Bio
    if (profile.bio) {
      const bioLabel = document.createElement("div");
      bioLabel.className = "profile-label";
      bioLabel.textContent = "Bio";
      container.appendChild(bioLabel);

      const bioEl = document.createElement("p");
      bioEl.className = "profile-bio";
      bioEl.textContent = profile.bio;
      container.appendChild(bioEl);
    }

    // Capabilities
    if (profile.capabilities.length > 0) {
      const capLabel = document.createElement("div");
      capLabel.className = "profile-label";
      capLabel.textContent = "Capabilities";
      container.appendChild(capLabel);

      const capsEl = document.createElement("div");
      capsEl.className = "profile-caps";
      for (const cap of profile.capabilities) {
        const tag = document.createElement("span");
        tag.className = "cap-tag";
        tag.textContent = cap;
        capsEl.appendChild(tag);
      }
      container.appendChild(capsEl);
    }

    // Timestamps
    const timeEl = document.createElement("div");
    timeEl.className = "profile-times";
    timeEl.textContent = `Joined: ${new Date(profile.joinedAt).toLocaleDateString()} · Last seen: ${new Date(profile.lastSeen).toLocaleTimeString()}`;
    container.appendChild(timeEl);

    // Focus button
    const focusBtn = document.createElement("button");
    focusBtn.className = "profile-focus-btn";
    focusBtn.textContent = "Focus Camera";
    focusBtn.addEventListener("click", () => onFocusAgent(profile.agentId));
    container.appendChild(focusBtn);

    // Send Message button
    const msgBtn = document.createElement("button");
    msgBtn.className = "profile-msg-btn";
    msgBtn.textContent = "💬 Send Message";
    msgBtn.addEventListener("click", () => {
      if (currentProfile && sendMessageHandler) {
        sendMessageHandler(currentProfile);
      }
    });
    container.appendChild(msgBtn);

    // Whisper Inbox section (from Whisper API)
    const inboxLabel = document.createElement("div");
    inboxLabel.className = "profile-label";
    inboxLabel.textContent = "📬 收件匣";
    container.appendChild(inboxLabel);

    const inboxList = document.createElement("div");
    inboxList.className = "profile-contacts";

    const loadingEl = document.createElement("div");
    loadingEl.className = "profile-contacts-empty";
    loadingEl.textContent = "載入中...";
    inboxList.appendChild(loadingEl);
    container.appendChild(inboxList);

    // Fetch inbox from Whisper API (public, no auth needed)
    const token = localStorage.getItem("oc_token") || "";
    fetch(`/api/dm/inbox?agent=${profile.agentId}`)
      .then(r => r.json())
      .then(data => {
        inboxList.textContent = "";
        const inbox = data.ok ? data.inbox : [];
        if (inbox.length === 0) {
          const emptyEl = document.createElement("div");
          emptyEl.className = "profile-contacts-empty";
          emptyEl.textContent = "尚無訊息";
          inboxList.appendChild(emptyEl);
        } else {
          for (const item of inbox) {
            const row = document.createElement("div");
            row.className = "profile-contact-row";
            row.style.cursor = "pointer";

            const nameSpan = document.createElement("span");
            nameSpan.className = "profile-contact-name";
            nameSpan.textContent = item.name || item.agentId;
            if (item.unread > 0) {
              const badge = document.createElement("span");
              badge.style.cssText = "background:#e74c3c;color:#fff;border-radius:10px;padding:1px 6px;font-size:11px;margin-left:6px;";
              badge.textContent = String(item.unread);
              nameSpan.appendChild(badge);
            }
            row.appendChild(nameSpan);

            const previewSpan = document.createElement("span");
            previewSpan.className = "profile-contact-addr";
            const msg = item.lastMessage || "";
            previewSpan.textContent = msg.length > 20 ? msg.slice(0, 20) + "…" : msg;
            row.appendChild(previewSpan);

            // Click → open conversation
            row.addEventListener("click", () => {
              openConversation(profile.agentId, item.agentId, item.name || item.agentId, token);
            });

            inboxList.appendChild(row);
          }
        }
      })
      .catch(() => {
        inboxList.textContent = "";
        const errEl = document.createElement("div");
        errEl.className = "profile-contacts-empty";
        errEl.textContent = "無法載入";
        inboxList.appendChild(errEl);
      });

    // Contacts section (from Whisper API)
    const contactsLabel = document.createElement("div");
    contactsLabel.className = "profile-label";
    contactsLabel.textContent = "📱 通訊錄";
    container.appendChild(contactsLabel);

    const contactsList = document.createElement("div");
    contactsList.className = "profile-contacts";

    fetch(`/api/dm/contacts?agent=${profile.agentId}`)
      .then(r => r.json())
      .then(data => {
        const contacts = data.ok ? data.contacts : [];
        if (contacts.length === 0) {
          const emptyEl = document.createElement("div");
          emptyEl.className = "profile-contacts-empty";
          emptyEl.textContent = "尚無聯絡人";
          contactsList.appendChild(emptyEl);
        } else {
          for (const c of contacts) {
            const row = document.createElement("div");
            row.className = "profile-contact-row";
            row.style.cursor = "pointer";

            const nameSpan = document.createElement("span");
            nameSpan.className = "profile-contact-name";
            nameSpan.textContent = c.name || c.agentId;
            row.appendChild(nameSpan);

            row.addEventListener("click", () => {
              openConversation(profile.agentId, c.agentId, c.name || c.agentId, token);
            });

            contactsList.appendChild(row);
          }
        }
      })
      .catch(() => {
        const emptyEl = document.createElement("div");
        emptyEl.className = "profile-contacts-empty";
        emptyEl.textContent = "尚無聯絡人";
        contactsList.appendChild(emptyEl);
      });
    container.appendChild(contactsList);

    container.classList.add("visible");
    window.addEventListener("keydown", handleEscapeKey);
  }

  function handleEscapeKey(e: KeyboardEvent): void {
    if (e.key === "Escape") hide();
  }

  function hide(): void {
    container.classList.remove("visible");
    currentProfile = null;
    window.removeEventListener("keydown", handleEscapeKey);
  }

  // Listen for overlay agent:select events (from online list clicks)
  window.addEventListener("agent:select", ((e: CustomEvent) => {
    const agentId = e.detail?.agentId;
    if (agentId) {
      onFocusAgent(agentId);
      // Also fetch and show profile
      const profile = e.detail?.profile;
      if (profile) {
        currentProfile = profile;
        render(profile);
      }
    }
  }) as EventListener);

  return {
    show(profile: AgentProfile) {
      currentProfile = profile;
      render(profile);
    },
    hide,
    onSendMessage(handler: (profile: AgentProfile) => void) {
      sendMessageHandler = handler;
    },
    onContactClick(handler: (ownerAgentId: string, contact: { name: string; kaspaAddress: string }) => void) {
      contactClickHandler = handler;
    },
  };
}
