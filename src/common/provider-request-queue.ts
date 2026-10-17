import { HttpException, HttpStatus } from '@nestjs/common';

type QueuedTask<T> = {
  task: () => Promise<T> | T;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  signal?: AbortSignal;
  timer?: ReturnType<typeof setTimeout>;
  abort?: () => void;
};

/** FIFO per-provider backpressure with queue timeout and cancellation. */
export class ProviderRequestQueue {
  private active = 0;
  private readonly pending: QueuedTask<unknown>[] = [];

  constructor(
    private readonly concurrency: number,
    private readonly maxQueued: number,
    private readonly queueTimeoutMs: number,
  ) {
    if (concurrency < 1 || maxQueued < 0 || queueTimeoutMs < 1) {
      throw new Error('Provider queue limits must be positive.');
    }
  }

  run<T>(task: () => Promise<T> | T, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(signal.reason ?? new Error('Request cancelled.'));
    if (this.active < this.concurrency && this.pending.length === 0) {
      return this.execute(task);
    }
    if (this.pending.length >= this.maxQueued) {
      return Promise.reject(new HttpException('Provider request queue is full.', HttpStatus.SERVICE_UNAVAILABLE));
    }

    return new Promise<T>((resolve, reject) => {
      const entry: QueuedTask<T> = { task, resolve, reject, signal };
      const remove = (error: unknown) => {
        const index = this.pending.indexOf(entry as QueuedTask<unknown>);
        if (index < 0) return;
        this.pending.splice(index, 1);
        if (entry.timer) clearTimeout(entry.timer);
        if (entry.abort) signal?.removeEventListener('abort', entry.abort);
        reject(error);
      };
      entry.timer = setTimeout(
        () => remove(new HttpException('Provider request queue timed out.', HttpStatus.GATEWAY_TIMEOUT)),
        this.queueTimeoutMs,
      );
      if (signal) {
        entry.abort = () => remove(signal.reason ?? new Error('Request cancelled.'));
        signal.addEventListener('abort', entry.abort, { once: true });
      }
      this.pending.push(entry as QueuedTask<unknown>);
    });
  }

  private async execute<T>(task: () => Promise<T> | T): Promise<T> {
    this.active += 1;
    try {
      return await task();
    } finally {
      this.active -= 1;
      this.startNext();
    }
  }

  private startNext(): void {
    const entry = this.pending.shift();
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    if (entry.abort) entry.signal?.removeEventListener('abort', entry.abort);
    void this.execute(entry.task).then(entry.resolve, entry.reject);
  }
}
