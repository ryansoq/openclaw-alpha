import type { AgentRegistry } from "./agent-registry.js";
import type { WorldState } from "./world-state.js";
import type { EventStore } from "./event-store.js";
import type { CommandQueue } from "./command-queue.js";
import type { ClawhubStore } from "./clawhub-store.js";
import type { NostrWorld } from "./nostr-world.js";
import type { ClientManager } from "./client-manager.js";
import type { GameLoop } from "./game-loop.js";
import type { AuthManager } from "./auth.js";
import type { WebhookNotifier } from "./webhook.js";
import type { TaskBoard } from "./task-board.js";
import type { PRBoard } from "./pr-board.js";
import type { RoomInfoMessage } from "./types.js";

/** Shared server context passed to route handlers */
export interface ServerContext {
  registry: AgentRegistry;
  state: WorldState;
  eventStore: EventStore;
  commandQueue: CommandQueue;
  clawhub: ClawhubStore;
  nostr: NostrWorld;
  clientManager: ClientManager;
  gameLoop: GameLoop;
  auth: AuthManager;
  webhook: WebhookNotifier;
  taskBoard: TaskBoard;
  prBoard: PRBoard;
  config: { port: number; host: string; roomId: string; roomName: string; roomDescription?: string; maxAgents: number };
  getRoomInfo: () => RoomInfoMessage;
}
