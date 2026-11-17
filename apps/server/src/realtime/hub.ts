import type { ServerEvent } from "@reviewroom/shared";
import type { WebSocket } from "ws";

/** Fan-out of server events to every connected browser tab. */
export class EventHub {
  readonly #clients = new Set<WebSocket>();

  get clientCount(): number {
    return this.#clients.size;
  }

  add(socket: WebSocket): void {
    this.#clients.add(socket);
    socket.on("close", () => this.#clients.delete(socket));
  }

  send(socket: WebSocket, event: ServerEvent): void {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(event));
  }

  broadcast(event: ServerEvent): void {
    const payload = JSON.stringify(event);
    for (const socket of this.#clients) {
      if (socket.readyState === socket.OPEN) socket.send(payload);
    }
  }
}
