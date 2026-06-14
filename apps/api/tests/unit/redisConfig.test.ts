import { describe, expect, it, vi } from 'vitest';

class FakeRedisClient {
  status: string;
  quit = vi.fn(async () => undefined);
  connect = vi.fn(async () => undefined);
  ping = vi.fn(async () => 'PONG');
  disconnect = vi.fn();
  on = vi.fn();

  constructor(status: string) {
    this.status = status;
  }
}

vi.mock('ioredis', () => ({
  default: class MockRedis extends FakeRedisClient {
    constructor(_: string, __: unknown) {
      super('wait');
    }
  },
}));

describe('redis config shutdown cleanup', () => {
  it('returns quietly when a client was never connected', async () => {
    const { shutdownRedisClients } = await import('../../src/config/redis');
    await expect(shutdownRedisClients()).resolves.toBeUndefined();
  });
});
