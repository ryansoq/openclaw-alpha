import { randomBytes } from "node:crypto";

/**
 * Session token manager.
 * Tokens are issued on register, required for agent commands.
 */
export class AuthManager {
  private tokenToAgent = new Map<string, string>();
  private agentToToken = new Map<string, string>();

  /** Issue a new token for an agent (revokes old token if exists) */
  issueToken(agentId: string): string {
    const old = this.agentToToken.get(agentId);
    if (old) this.tokenToAgent.delete(old);

    const token = randomBytes(24).toString("base64url");
    this.tokenToAgent.set(token, agentId);
    this.agentToToken.set(agentId, token);
    return token;
  }

  /** Validate that a token belongs to the claimed agentId */
  validate(token: string | undefined, agentId: string): boolean {
    if (!token) return false;
    return this.tokenToAgent.get(token) === agentId;
  }

  /** Revoke all tokens for an agent */
  revoke(agentId: string): void {
    const token = this.agentToToken.get(agentId);
    if (token) this.tokenToAgent.delete(token);
    this.agentToToken.delete(agentId);
  }
}
