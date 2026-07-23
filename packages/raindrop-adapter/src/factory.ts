import type { RuntimeConfig } from "@policy/shared/index";
import { CompositeTraceRecorder } from "./composite.js";
import { LocalTraceRecorder } from "./local.js";
import { RaindropTraceRecorder } from "./raindrop.js";
import type { TraceRecorder } from "./types.js";

export function createTraceRecorder(
  config: RuntimeConfig["raindrop"],
  context: { requestId: string; conversationId: string },
): TraceRecorder {
  const local = new LocalTraceRecorder();
  if (!config.enabled || !config.writeKey) return local;
  return new CompositeTraceRecorder([
    local,
    new RaindropTraceRecorder({
      writeKey: config.writeKey,
      ...(config.projectId ? { projectId: config.projectId } : {}),
      requestId: context.requestId,
      conversationId: context.conversationId,
      captureContent: config.captureContent,
    }),
  ]);
}
