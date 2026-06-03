export interface ScribeHeartbeatSocket {
  close(code?: number, reason?: string): void;
  terminate(): void;
  ping(): void;
}

interface HeartbeatEntry {
  lastPongAt: number;
}

interface HeartbeatControllerArgs<TSocket extends ScribeHeartbeatSocket> {
  timeoutMs: number;
  closeCode: number;
  closeReason: string;
  onTerminate: (ws: TSocket) => void;
}

/**
 * BUG-314 — Ping/Pong heartbeat liveness controller for scribe WebSockets.
 */
export class ScribeWebSocketHeartbeatController<TSocket extends ScribeHeartbeatSocket = ScribeHeartbeatSocket> {
  private readonly entries = new Map<TSocket, HeartbeatEntry>();

  constructor(private readonly args: HeartbeatControllerArgs<TSocket>) {}

  register(ws: TSocket, now = Date.now()): void {
    this.entries.set(ws, { lastPongAt: now });
  }

  unregister(ws: TSocket): void {
    this.entries.delete(ws);
  }

  markPong(ws: TSocket, now = Date.now()): void {
    const entry = this.entries.get(ws);
    if (entry) entry.lastPongAt = now;
  }

  tick(clients: Iterable<TSocket>, now = Date.now()): void {
    for (const ws of clients) {
      const entry = this.entries.get(ws);
      if (!entry) {
        this.register(ws, now);
      }

      const lastPongAt = this.entries.get(ws)?.lastPongAt ?? now;
      if (now - lastPongAt > this.args.timeoutMs) {
        this.terminateClient(ws);
        continue;
      }

      try {
        ws.ping();
      } catch {
        this.terminateClient(ws);
      }
    }
  }

  private terminateClient(ws: TSocket): void {
    try { ws.close(this.args.closeCode, this.args.closeReason); } catch { /* best-effort */ }
    try { ws.terminate(); } catch { /* best-effort */ }
    this.unregister(ws);
    this.args.onTerminate(ws);
  }
}
