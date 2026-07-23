import { PolicyAssistantError, type ErrorCode } from "./errors.js";

export async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  code: ErrorCode,
): Promise<T> {
  const controller = new AbortController();
  const timeout = new Promise<never>((_resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort();
      reject(new PolicyAssistantError(code, `Operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref?.();
    controller.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
  });
  try {
    return await Promise.race([operation(controller.signal), timeout]);
  } finally {
    if (!controller.signal.aborted) controller.abort();
  }
}

export class ConcurrencyGate {
  private active = 0;
  private readonly queue: Array<{
    resolve: (release: () => void) => void;
    reject: (error: Error) => void;
  }> = [];

  constructor(
    private readonly maxConcurrent: number,
    private readonly maxQueue: number,
  ) {}

  async acquire(): Promise<() => void> {
    if (this.active < this.maxConcurrent) {
      this.active += 1;
      return this.releaseFactory();
    }
    if (this.queue.length >= this.maxQueue) {
      throw new PolicyAssistantError("INTERNAL_ERROR", "Runtime queue is full");
    }
    return new Promise<() => void>((resolve, reject) => this.queue.push({ resolve, reject }));
  }

  private releaseFactory(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.queue.shift();
      if (next) next.resolve(this.releaseFactory());
      else this.active -= 1;
    };
  }
}
