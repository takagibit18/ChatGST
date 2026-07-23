export const errorCodes = [
  "INVALID_INPUT",
  "UNSUPPORTED_REGION",
  "MISSING_REQUIRED_CONTEXT",
  "RETRIEVAL_EMPTY",
  "POLICY_VERSION_CONFLICT",
  "MODEL_TIMEOUT",
  "MODEL_ERROR",
  "TOOL_TIMEOUT",
  "TOOL_ERROR",
  "INVALID_MODEL_OUTPUT",
  "VALIDATION_FAILED",
  "SESSION_TURN_LIMIT",
  "RAG_NOT_READY",
  "RAINDROP_UNAVAILABLE",
  "WEB_UI_ADAPTER_ERROR",
  "INTERNAL_ERROR",
] as const;

export type ErrorCode = (typeof errorCodes)[number];

const safeMessages: Record<ErrorCode, string> = {
  INVALID_INPUT: "输入内容不符合要求，请简要描述要查询的政策问题。",
  UNSUPPORTED_REGION: "当前仅支持北京市和河北省的育儿补贴政策。",
  MISSING_REQUIRED_CONTEXT: "还需要补充一项关键信息才能判断。",
  RETRIEVAL_EMPTY: "暂未检索到足够的有效政策依据，建议咨询当地主管部门。",
  POLICY_VERSION_CONFLICT: "检索到同一时期的政策版本冲突，暂不作确定结论。",
  MODEL_TIMEOUT: "回答生成超时，请稍后重试。",
  MODEL_ERROR: "回答生成暂时不可用，请稍后重试。",
  TOOL_TIMEOUT: "政策查询超时，请稍后重试。",
  TOOL_ERROR: "政策查询暂时不可用，请稍后重试。",
  INVALID_MODEL_OUTPUT: "回答格式异常，系统已停止展示不完整内容。",
  VALIDATION_FAILED: "回答未通过安全校验，建议咨询当地主管部门。",
  SESSION_TURN_LIMIT: "本次会话已完成两次输入，请新建会话后继续查询。",
  RAG_NOT_READY: "政策索引尚未准备好，请先构建本地索引。",
  RAINDROP_UNAVAILABLE: "观测服务不可用，但不影响政策查询。",
  WEB_UI_ADAPTER_ERROR: "页面连接暂时异常，请刷新后重试。",
  INTERNAL_ERROR: "系统暂时不可用，请稍后重试。",
};

export class PolicyAssistantError extends Error {
  readonly code: ErrorCode;
  readonly safeMessage: string;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(code: ErrorCode, message?: string, details?: Readonly<Record<string, unknown>>, cause?: unknown) {
    super(message ?? code, { cause });
    this.name = "PolicyAssistantError";
    this.code = code;
    this.safeMessage = safeMessages[code];
    this.details = details;
  }
}

export function asPolicyError(error: unknown): PolicyAssistantError {
  return error instanceof PolicyAssistantError
    ? error
    : new PolicyAssistantError("INTERNAL_ERROR", error instanceof Error ? error.message : String(error), undefined, error);
}

export function safeMessageFor(code: ErrorCode): string {
  return safeMessages[code];
}
