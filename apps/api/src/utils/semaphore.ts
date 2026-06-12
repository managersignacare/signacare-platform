import { resolvePositiveIntEnv } from '../shared/positiveIntEnv';

/**
 * Counting Semaphore — limits concurrent access to a resource.
 *
 * Used to prevent Ollama/Whisper from being overwhelmed when many
 * users request AI generation simultaneously.
 *
 * Usage:
 *   const llmSemaphore = new Semaphore(3); // max 3 concurrent LLM calls
 *   const result = await llmSemaphore.run(() => callOllama(prompt));
 */

export class Semaphore {
  private count: number;
  private readonly max: number;
  private readonly queue: (() => void)[] = [];

  constructor(max: number) {
    this.max = max;
    this.count = 0;
  }

  async acquire(): Promise<void> {
    if (this.count < this.max) {
      this.count++;
      return;
    }
    return new Promise<void>(resolve => this.queue.push(resolve));
  }

  tryAcquire(): boolean {
    if (this.count >= this.max) return false;
    this.count++;
    return true;
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next(); // hand the slot to the next waiter
    } else {
      this.count--;
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /** Current number of active slots */
  get active(): number { return this.count; }

  /** Number of requests waiting in queue */
  get waiting(): number { return this.queue.length; }
}

/** Global LLM semaphore — limits concurrent Ollama requests */
export const llmSemaphore = new Semaphore(
  resolvePositiveIntEnv('LLM_MAX_CONCURRENT', {
    fallback: 3,
    max: 12,
    loggerContext: { configSurface: 'llm_semaphore' },
  })
);

/** Global Whisper semaphore — limits concurrent transcription requests */
export const whisperSemaphore = new Semaphore(
  resolvePositiveIntEnv('WHISPER_MAX_CONCURRENT', {
    fallback: 2,
    max: 8,
    loggerContext: { configSurface: 'whisper_semaphore' },
  })
);

/** Global ambient upload semaphore — acquired before multer buffers audio. */
export const ambientUploadSemaphore = new Semaphore(
  resolvePositiveIntEnv('AMBIENT_UPLOAD_MAX_CONCURRENT', {
    fallback: 1,
    max: 4,
    loggerContext: { configSurface: 'ambient_upload_semaphore' },
  })
);
