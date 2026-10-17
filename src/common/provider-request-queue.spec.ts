import { HttpException } from '@nestjs/common';
import { ProviderRequestQueue } from './provider-request-queue';

describe('ProviderRequestQueue', () => {
  it('keeps work FIFO and within the concurrency limit', async () => {
    const queue = new ProviderRequestQueue(1, 2, 1000);
    const order: number[] = [];
    let release!: () => void;
    const blocked = queue.run(() => new Promise<void>((resolve) => { release = resolve; }));
    const second = queue.run(async () => { order.push(2); });
    const third = queue.run(async () => { order.push(3); });
    release();
    await Promise.all([blocked, second, third]);
    expect(order).toEqual([2, 3]);
  });

  it('rejects a saturated queue and removes cancelled work', async () => {
    const queue = new ProviderRequestQueue(1, 1, 1000);
    const blocked = queue.run(() => new Promise<void>(() => undefined));
    const controller = new AbortController();
    const cancelled = queue.run(async () => 'never', controller.signal);
    const saturated = queue.run(async () => 'full');
    controller.abort(new Error('Request cancelled.'));
    await expect(cancelled).rejects.toThrow('Request cancelled');
    await expect(saturated).rejects.toBeInstanceOf(HttpException);
    void blocked;
  });
});
