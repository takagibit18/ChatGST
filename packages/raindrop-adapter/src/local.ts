import type { ApplicationTraceEvent, TraceRecorder } from "./types.js";
import { sanitizeTracePayload } from "./sanitize.js";

export class LocalTraceRecorder implements TraceRecorder {
  private readonly events: ApplicationTraceEvent[] = [];
  private attached = false;
  private closed = false;

  async attach(_agent: unknown): Promise<void> {
    this.attached = true;
  }

  async recordApplicationEvent(event: ApplicationTraceEvent): Promise<void> {
    if (this.closed) return;
    const sanitized = sanitizeTracePayload(event, false) as ApplicationTraceEvent;
    this.events.push(sanitized);
    if (this.events.length > 1000) this.events.shift();
  }

  async shutdown(): Promise<void> {
    this.closed = true;
  }

  snapshot(): ReadonlyArray<ApplicationTraceEvent> {
    return structuredClone(this.events);
  }

  isAttached(): boolean {
    return this.attached;
  }
}

