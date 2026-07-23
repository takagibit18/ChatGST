import {
  createRaindropPiAgent,
  type RaindropPiAgentClient,
  type RaindropPiAgentOptions,
} from "@raindrop-ai/pi-agent";
import { anonymizeId } from "@policy/shared/index";
import { sanitizeTracePayload } from "./sanitize.js";
import type { ApplicationTraceEvent, TraceRecorder } from "./types.js";

type AgentListener = (event: unknown, signal: AbortSignal) => Promise<void> | void;
type SubscribableAgent = { subscribe(listener: AgentListener): () => void };

export type RaindropTraceOptions = {
  writeKey: string;
  projectId?: string;
  requestId: string;
  conversationId: string;
  captureContent: boolean;
  endpoint?: string;
};

export type RaindropClientFactory = (options: RaindropPiAgentOptions) => RaindropPiAgentClient;

export class RaindropTraceRecorder implements TraceRecorder {
  private readonly client: RaindropPiAgentClient;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly options: RaindropTraceOptions,
    factory: RaindropClientFactory = createRaindropPiAgent,
  ) {
    this.client = factory({
      writeKey: options.writeKey,
      ...(options.endpoint ? { endpoint: options.endpoint } : {}),
      ...(options.projectId ? { projectId: options.projectId } : {}),
      userId: anonymizeId(options.conversationId),
      convoId: anonymizeId(options.conversationId),
      eventId: () => options.requestId,
      eventName: "policy_assistant_request",
      properties: {
        request_id: options.requestId,
        conversation_id: anonymizeId(options.conversationId),
        capture_content: options.captureContent,
      },
      localWorkshopUrl: null,
      traces: { enabled: true },
      events: { enabled: true },
    });
  }

  async attach(agent: unknown): Promise<void> {
    if (!agent || typeof (agent as Partial<SubscribableAgent>).subscribe !== "function") {
      throw new TypeError("RaindropTraceRecorder requires a subscribable Pi Agent");
    }
    const actual = agent as SubscribableAgent;
    const proxy: SubscribableAgent = {
      subscribe: (listener) =>
        actual.subscribe((event, signal) => listener(sanitizeTracePayload(event, this.options.captureContent), signal)),
    };
    this.unsubscribe = this.client.subscribe(proxy as never, {
      userId: anonymizeId(this.options.conversationId),
      convoId: anonymizeId(this.options.conversationId),
      eventId: () => this.options.requestId,
      properties: { request_id: this.options.requestId },
    });
  }

  async recordApplicationEvent(event: ApplicationTraceEvent): Promise<void> {
    const sanitized = sanitizeTracePayload(event, this.options.captureContent) as ApplicationTraceEvent;
    const { type: applicationType, ...metadata } = sanitized;
    try {
      await this.client.signals.track({
        eventId: this.options.requestId,
        name: `application_${applicationType}`,
        type: "default",
        ...metadata,
        conversation_id: anonymizeId(event.conversation_id),
      });
    } catch {
      // Observability is deliberately non-blocking.
    }
  }

  async shutdown(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    try {
      await this.client.flush();
    } catch {
      // Continue to shutdown even if flush fails.
    }
    try {
      await this.client.shutdown();
    } catch {
      // Telemetry failure must never fail the policy request.
    }
  }
}
