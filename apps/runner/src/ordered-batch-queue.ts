type PendingBatch<T> = {
  values: T[];
  key: string;
  bytes: number;
  completion: Promise<void>;
};

/**
 * Coalesces only the pending tail of a serial queue. A null key or an operation
 * closes that tail unconditionally, so unknown events cannot cross a boundary.
 * There is no fill timer and no parallel execution of queued batches.
 */
export class OrderedBatchQueue<T> {
  private tail: Promise<void> = Promise.resolve();
  private pending: PendingBatch<T> | null = null;

  constructor(
    private readonly process: (values: readonly T[]) => Promise<void>,
    private readonly limits: { maxCount: number; maxBytes: number },
  ) {
    if (!Number.isSafeInteger(limits.maxCount) || limits.maxCount < 1 || !Number.isSafeInteger(limits.maxBytes) || limits.maxBytes < 1) {
      throw new RangeError("invalid ordered batch queue limits");
    }
  }

  enqueue(value: T, key: string | null, bytes: number): Promise<void> {
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      return Promise.reject(new RangeError("invalid queued event size"));
    }
    const pending = this.pending;
    if (key !== null && pending?.key === key && pending.values.length < this.limits.maxCount && pending.bytes + bytes <= this.limits.maxBytes) {
      pending.values.push(value);
      pending.bytes += bytes;
      return pending.completion;
    }
    const values = [value];
    const completion = this.enqueueOperation(async () => {
      if (this.pending?.values === values) this.pending = null;
      await this.process(values);
    });
    if (key !== null) this.pending = { values, key, bytes, completion };
    return completion;
  }

  enqueueOperation<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
    this.pending = null;
    const completion = this.tail.then(operation);
    // The caller receives the original rejection. As with the original
    // notification chain, no native event or task is automatically replayed.
    this.tail = completion.then(() => undefined, () => undefined);
    return completion;
  }
}
