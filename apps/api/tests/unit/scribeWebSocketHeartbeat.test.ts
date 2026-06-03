import { describe, expect, it, vi } from 'vitest';
import { SCRIBE_WS_CLOSE } from '../../src/mcp/scribeStreaming';
import { ScribeWebSocketHeartbeatController } from '../../src/mcp/scribeWebSocketHeartbeat';

class FakeWs {
  readonly send = vi.fn<(data: string) => void>();
  readonly close = vi.fn<(code?: number, reason?: string) => void>();
  readonly terminate = vi.fn<() => void>();
  readonly ping = vi.fn<() => void>();

  private readonly pongListeners: Array<() => void> = [];

  on(event: 'message', _listener: (data: Buffer | string) => void): void;
  on(event: 'close', _listener: () => void): void;
  on(event: 'error', _listener: (err: Error) => void): void;
  on(event: 'pong', listener: () => void): void;
  on(
    event: 'message' | 'close' | 'error' | 'pong',
    listener: ((data: Buffer | string) => void) | ((err: Error) => void) | (() => void),
  ): void {
    if (event === 'pong') this.pongListeners.push(listener as () => void);
  }

  emitPong(): void {
    for (const listener of this.pongListeners) listener();
  }
}

describe('BUG-314 WebSocket heartbeat controller', () => {
  it('BUG-314-1: healthy client gets pinged and stays connected', () => {
    const onTerminate = vi.fn<(ws: FakeWs) => void>();
    const controller = new ScribeWebSocketHeartbeatController({
      timeoutMs: 45_000,
      closeCode: SCRIBE_WS_CLOSE.HEARTBEAT_TIMEOUT,
      closeReason: 'HEARTBEAT_TIMEOUT',
      onTerminate,
    });
    const ws = new FakeWs();

    controller.register(ws, 0);
    controller.tick([ws], 10_000);

    expect(ws.ping).toHaveBeenCalledTimes(1);
    expect(ws.close).not.toHaveBeenCalled();
    expect(ws.terminate).not.toHaveBeenCalled();
    expect(onTerminate).not.toHaveBeenCalled();
  });

  it('BUG-314-2: stale client is closed + terminated with heartbeat timeout code', () => {
    const onTerminate = vi.fn<(ws: FakeWs) => void>();
    const controller = new ScribeWebSocketHeartbeatController({
      timeoutMs: 45_000,
      closeCode: SCRIBE_WS_CLOSE.HEARTBEAT_TIMEOUT,
      closeReason: 'HEARTBEAT_TIMEOUT',
      onTerminate,
    });
    const ws = new FakeWs();

    controller.register(ws, 0);
    controller.tick([ws], 50_001);

    expect(ws.ping).not.toHaveBeenCalled();
    expect(ws.close).toHaveBeenCalledWith(SCRIBE_WS_CLOSE.HEARTBEAT_TIMEOUT, 'HEARTBEAT_TIMEOUT');
    expect(ws.terminate).toHaveBeenCalledTimes(1);
    expect(onTerminate).toHaveBeenCalledWith(ws);
  });

  it('BUG-314-3: pong refreshes liveness so timeout window resets', () => {
    const onTerminate = vi.fn<(ws: FakeWs) => void>();
    const controller = new ScribeWebSocketHeartbeatController({
      timeoutMs: 45_000,
      closeCode: SCRIBE_WS_CLOSE.HEARTBEAT_TIMEOUT,
      closeReason: 'HEARTBEAT_TIMEOUT',
      onTerminate,
    });
    const ws = new FakeWs();

    controller.register(ws, 0);
    controller.markPong(ws, 40_000);
    controller.tick([ws], 80_000);

    expect(ws.ping).toHaveBeenCalledTimes(1);
    expect(ws.close).not.toHaveBeenCalled();
    expect(ws.terminate).not.toHaveBeenCalled();
    expect(onTerminate).not.toHaveBeenCalled();
  });

  it('BUG-314-4: ping failure is fail-closed and terminates the client', () => {
    const onTerminate = vi.fn<(ws: FakeWs) => void>();
    const controller = new ScribeWebSocketHeartbeatController({
      timeoutMs: 45_000,
      closeCode: SCRIBE_WS_CLOSE.HEARTBEAT_TIMEOUT,
      closeReason: 'HEARTBEAT_TIMEOUT',
      onTerminate,
    });
    const ws = new FakeWs();
    ws.ping.mockImplementation(() => {
      throw new Error('socket write failed');
    });

    controller.register(ws, 0);
    controller.tick([ws], 1_000);

    expect(ws.close).toHaveBeenCalledWith(SCRIBE_WS_CLOSE.HEARTBEAT_TIMEOUT, 'HEARTBEAT_TIMEOUT');
    expect(ws.terminate).toHaveBeenCalledTimes(1);
    expect(onTerminate).toHaveBeenCalledWith(ws);
  });
});
