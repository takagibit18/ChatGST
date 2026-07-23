export type ApplicationTraceEvent = {
  type: "request_start" | "retrieval" | "model" | "validation" | "request_end" | "error";
  request_id: string;
  conversation_id: string;
  timestamp: string;
  status?: "ok" | "error";
  duration_ms?: number;
  model_calls?: number;
  tool_calls?: number;
  input_tokens?: number;
  output_tokens?: number;
  attributes?: Record<string, unknown>;
};

export interface TraceRecorder {
  attach(agent: unknown): Promise<void>;
  recordApplicationEvent(event: ApplicationTraceEvent): Promise<void>;
  shutdown(): Promise<void>;
}

