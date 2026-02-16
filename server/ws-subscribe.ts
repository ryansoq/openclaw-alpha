import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";

/**
 * WebSocket subscription manager for real-time message push.
 * External agents connect to ws://host:port/subscribe/:kaspaAddress
 * to receive push notifications for messages sent to that address.
 *
 * This is independent of the office UI's ClientManager/WSBridge.
 */

export interface SubscriptionMessage {
  type: "new_message";
  fromAddress: string;
  toAddress: string;
  protocol: { v: number; t: string; d: string; a: Record<string, unknown> };
  txId: string;
  timestamp: number;
}

export class SubscriptionManager {
  private wss: WebSocketServer;
  /** address → set of connected WebSocket clients */
  private subscribers = new Map<string, Set<WebSocket>>();

  constructor(server: Server) {
    this.wss = new WebSocketServer({ server, path: "/subscribe" });

    this.wss.on("connection", (ws: WebSocket, req) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      // Path is /subscribe, address comes as first path segment after /subscribe/
      // But since WSS path is /subscribe, req.url will be /subscribe/kaspatest:xxx
      // Actually with path: "/subscribe", ws only matches exact /subscribe
      // We need noServer or a different approach. Let's handle via upgrade manually.
    });

    // Close — we'll use a different approach with noServer
    this.wss.close();

    // Create with noServer to handle path-based routing
    this.wss = new WebSocketServer({ noServer: true });

    this.wss.on("connection", (ws: WebSocket, address: string) => {
      if (!this.subscribers.has(address)) {
        this.subscribers.set(address, new Set());
      }
      this.subscribers.get(address)!.add(ws);
      console.log(`[ws-subscribe] ${address} subscribed (${this.subscribers.get(address)!.size} clients)`);

      ws.send(JSON.stringify({ type: "subscribed", address }));

      ws.on("close", () => {
        const set = this.subscribers.get(address);
        if (set) {
          set.delete(ws);
          if (set.size === 0) this.subscribers.delete(address);
        }
        console.log(`[ws-subscribe] ${address} disconnected`);
      });

      ws.on("error", () => {
        ws.close();
      });
    });

    // Handle upgrade on the server
    server.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const pathname = url.pathname;

      // Match /subscribe/:address
      const match = pathname.match(/^\/subscribe\/(.+)$/);
      if (!match) return; // Let other WSS handle it (e.g., /ws for office UI)

      const address = decodeURIComponent(match[1]);

      // Validate address format
      if (!address.startsWith("kaspa:") && !address.startsWith("kaspatest:")) {
        socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
        socket.destroy();
        return;
      }

      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.wss.emit("connection", ws, address);
      });
    });
  }

  /** Push a message to all subscribers of a given address */
  pushToAddress(address: string, message: SubscriptionMessage): number {
    const set = this.subscribers.get(address);
    if (!set || set.size === 0) return 0;

    const payload = JSON.stringify(message);
    let sent = 0;
    for (const ws of set) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
        sent++;
      }
    }
    return sent;
  }

  /** Get count of subscribers for an address */
  getSubscriberCount(address: string): number {
    return this.subscribers.get(address)?.size ?? 0;
  }

  /** Total subscriber connections */
  get totalConnections(): number {
    let total = 0;
    for (const set of this.subscribers.values()) total += set.size;
    return total;
  }
}
