import { serverBaseUrl } from "../main.js";

interface AuthState {
  token: string;
  agentId: string;
  name: string;
}

let authState: AuthState | null = null;

/** Get current auth state */
export function getAuth(): AuthState | null {
  return authState;
}

/**
 * Setup Telegram Login button in the chat area.
 * After login, user can type messages in Office Chat.
 */
export function setupTelegramLogin(
  chatContainer: HTMLElement,
  onLogin: (auth: AuthState) => void,
): void {
  // Fetch bot username from server
  const apiUrl = serverBaseUrl ? `${serverBaseUrl}/api/auth/config` : "/api/auth/config";
  fetch(apiUrl)
    .then(r => r.json())
    .then(data => {
      if (!data.ok || !data.botUsername) return;
      createLoginButton(chatContainer, data.botUsername, onLogin);
    })
    .catch(() => {});
}

function createLoginButton(
  container: HTMLElement,
  botUsername: string,
  onLogin: (auth: AuthState) => void,
): void {
  const wrapper = document.createElement("div");
  wrapper.className = "tg-login-wrapper";

  const btn = document.createElement("button");
  btn.className = "tg-login-btn";
  btn.textContent = "🔑 Login with Telegram";
  btn.addEventListener("click", () => {
    openTelegramLogin(botUsername, onLogin, wrapper);
  });

  wrapper.appendChild(btn);
  container.appendChild(wrapper);
}

function openTelegramLogin(
  botUsername: string,
  onLogin: (auth: AuthState) => void,
  wrapper: HTMLElement,
): void {
  // Use Telegram Login Widget in popup mode
  const origin = window.location.origin;
  const callbackUrl = `${origin}/api/auth/telegram-callback`;

  // Create the Telegram script dynamically
  const script = document.createElement("script");
  script.src = "https://telegram.org/js/telegram-widget.js?22";
  script.setAttribute("data-telegram-login", botUsername);
  script.setAttribute("data-size", "medium");
  script.setAttribute("data-onauth", "__tgLoginCallback(user)");
  script.setAttribute("data-request-access", "write");

  // Global callback
  (window as any).__tgLoginCallback = async (user: Record<string, string>) => {
    try {
      const apiUrl = serverBaseUrl
        ? `${serverBaseUrl}/api/auth/telegram`
        : "/api/auth/telegram";
      const resp = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(user),
      });
      const data = await resp.json();
      if (data.ok) {
        authState = {
          token: data.token,
          agentId: data.profile.agentId,
          name: data.user.name,
        };
        // Replace login button with user info
        wrapper.innerHTML = "";
        const info = document.createElement("span");
        info.className = "tg-login-info";
        info.textContent = `✅ ${data.user.name}`;
        wrapper.appendChild(info);
        onLogin(authState);
      }
    } catch (err) {
      console.error("[tg-login] Error:", err);
    }
  };

  // Add script to wrapper (renders the Telegram button)
  wrapper.innerHTML = "";
  wrapper.appendChild(script);
}
