import { createHmac, createHash } from "node:crypto";

/**
 * Telegram Login Widget authentication.
 * Verifies the data-auth hash sent by Telegram's login widget.
 * https://core.telegram.org/widgets/login#checking-authorization
 */

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
}

/**
 * Verify Telegram login data.
 * Returns the user if valid, null if tampered or expired.
 */
export function verifyTelegramAuth(
  data: Record<string, string>,
  botToken: string,
  maxAgeSeconds = 86400, // 24 hours
): TelegramUser | null {
  const { hash, ...rest } = data;
  if (!hash) return null;

  // 1. Build check string (sorted key=value pairs)
  const checkString = Object.keys(rest)
    .sort()
    .map(k => `${k}=${rest[k]}`)
    .join("\n");

  // 2. Secret key = SHA256(bot_token)
  const secretKey = createHash("sha256").update(botToken).digest();

  // 3. HMAC-SHA256 of check string
  const hmac = createHmac("sha256", secretKey)
    .update(checkString)
    .digest("hex");

  // 4. Compare
  if (hmac !== hash) return null;

  // 5. Check auth_date freshness
  const authDate = Number(rest.auth_date);
  const now = Math.floor(Date.now() / 1000);
  if (now - authDate > maxAgeSeconds) return null;

  return {
    id: Number(rest.id),
    first_name: rest.first_name,
    last_name: rest.last_name,
    username: rest.username,
    photo_url: rest.photo_url,
    auth_date: authDate,
  };
}
