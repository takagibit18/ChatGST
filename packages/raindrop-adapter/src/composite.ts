import type { ApplicationTraceEvent, TraceRecorder } from "./types.js";

export class CompositeTraceRecorder implements TraceRecorder {
  constructor(private readonly recorders: TraceRecorder[]) {}

  async attach(agent: unknown): Promise<void> {
    await Promise.allSettled(this.recorders.map((recorder) => recorder.attach(agent)));
  }

  async recordApplicationEvent(event: ApplicationTraceEvent): Promise<void> {
    await Promise.allSettled(this.recorders.map((recorder) => recorder.recordApplicationEvent(event)));
  }

  async shutdown(): Promise<void> {
    await Promise.allSettled(this.recorders.map((recorder) => recorder.shutdown()));
  }
}

