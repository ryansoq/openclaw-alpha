export interface ChatLogAPI {
  addMessage(agentId: string, text: string, timestamp?: number): void;
  addSystem(text: string): void;
  /** Get the container element (for adding login UI) */
  getContainer(): HTMLElement;
  /** Show the chat input box */
  showInput(onSend: (text: string) => void): void;
}

/**
 * Scrollable chat log panel (bottom-left).
 * Shows broadcast messages and system events.
 */
export function setupChatLog(): ChatLogAPI {
  const container = document.getElementById("chat-log")!;

  // Header with toggle button
  const headerEl = document.createElement("div");
  headerEl.className = "chat-header";
  
  const titleEl = document.createElement("span");
  titleEl.className = "chat-title";
  titleEl.textContent = "Office Chat";
  headerEl.appendChild(titleEl);
  
  const toggleEl = document.createElement("span");
  toggleEl.className = "chat-toggle";
  toggleEl.textContent = "▾";
  headerEl.appendChild(toggleEl);
  
  container.appendChild(headerEl);

  const messagesEl = document.createElement("div");
  messagesEl.className = "chat-messages";
  container.appendChild(messagesEl);
  
  // Collapse / expand on header click
  let collapsed = false;
  headerEl.addEventListener("click", () => {
    collapsed = !collapsed;
    messagesEl.style.display = collapsed ? "none" : "";
    toggleEl.textContent = collapsed ? "▸" : "▾";
    container.classList.toggle("collapsed", collapsed);
  });

  // Parse markdown-style formatting: @mentions, `code`, ```code blocks```
  function parseMarkdown(text: string): string {
    // Escape HTML first
    let result = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    
    // Code blocks: ```lang\ncode\n``` or ```code```
    result = result.replace(
      /```(\w*)\n?([\s\S]*?)```/g,
      (_match, lang, code) => {
        const langClass = lang ? ` data-lang="${lang}"` : "";
        return `<pre class="chat-code-block"${langClass}><code>${code.trim()}</code></pre>`;
      }
    );
    
    // Inline code: `code`
    result = result.replace(
      /`([^`]+)`/g,
      '<code class="chat-code-inline">$1</code>'
    );
    
    // @mentions
    result = result.replace(
      /@(\w+)/g,
      '<span class="chat-mention">@$1</span>'
    );
    
    // Bold: **text** or __text__
    result = result.replace(
      /\*\*([^*]+)\*\*/g,
      '<strong>$1</strong>'
    );
    result = result.replace(
      /__([^_]+)__/g,
      '<strong>$1</strong>'
    );
    
    return result;
  }

  function addEntry(className: string, content: string, useHtml = false): void {
    const el = document.createElement("div");
    el.className = `chat-entry ${className}`;
    if (useHtml) {
      el.innerHTML = content;
    } else {
      el.textContent = content;
    }
    messagesEl.appendChild(el);

    // Keep max 100 entries
    while (messagesEl.children.length > 100) {
      messagesEl.removeChild(messagesEl.firstChild!);
    }

    // Auto-scroll to bottom
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  return {
    getContainer() { return container; },
    showInput(onSend: (text: string) => void) {
      // Don't add twice
      if (container.querySelector(".chat-input-row")) return;
      const row = document.createElement("div");
      row.className = "chat-input-row";
      const input = document.createElement("input");
      input.className = "chat-input";
      input.type = "text";
      input.placeholder = "Type a message...";
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && input.value.trim()) {
          onSend(input.value.trim());
          input.value = "";
        }
      });
      const sendBtn = document.createElement("button");
      sendBtn.className = "chat-send-btn";
      sendBtn.textContent = "Send";
      sendBtn.addEventListener("click", () => {
        if (input.value.trim()) {
          onSend(input.value.trim());
          input.value = "";
        }
      });
      row.appendChild(input);
      row.appendChild(sendBtn);
      container.appendChild(row);
    },
    addMessage(agentId: string, text: string, timestamp?: number) {
      const time = new Date(timestamp ?? Date.now()).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      const prefix = `[${time}] <span class="chat-agent">${agentId}</span>: `;
      const content = prefix + parseMarkdown(text);
      addEntry("chat-msg", content, true);
    },
    addSystem(text: string) {
      addEntry("chat-system", `— ${text}`);
    },
  };
}
