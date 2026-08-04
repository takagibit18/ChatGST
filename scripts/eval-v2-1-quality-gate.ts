export type RetrievalFailureResult = {
  case_id: string;
  expected: string;
  predicted: string;
  document_hit: boolean | null;
};

export type PassFailureResult = {
  passed: boolean;
};

export type FailureGroups = {
  dev_failures: string[];
  regression_failures: string[];
  conversation_failures: string[];
  safety_failures: string[];
};

export function collectFailureGroups(input: {
  dev: RetrievalFailureResult[];
  regression: RetrievalFailureResult[];
  conversations: Array<PassFailureResult & { scenario_id: string }>;
  safety: Array<PassFailureResult & { case_id: string }>;
}): FailureGroups {
  const retrievalFailures = (items: RetrievalFailureResult[]) => items
    .filter((item) => item.expected !== item.predicted || item.document_hit === false)
    .map((item) => item.case_id);

  return {
    dev_failures: retrievalFailures(input.dev),
    regression_failures: retrievalFailures(input.regression),
    conversation_failures: input.conversations.filter((item) => !item.passed).map((item) => item.scenario_id),
    safety_failures: input.safety.filter((item) => !item.passed).map((item) => item.case_id),
  };
}

export function flattenFailureGroups(groups: FailureGroups): string[] {
  return [...new Set([
    ...groups.dev_failures,
    ...groups.regression_failures,
    ...groups.conversation_failures,
    ...groups.safety_failures,
  ])];
}

export function buildQualityGate(input: {
  regressionCases: number;
  regressionCorrect: number;
  regressionNoAnswerRecall: number;
  failureGroups: FailureGroups;
  staleContextLeakageRate: number;
}) {
  const regressionBehaviorAccuracy = input.regressionCases === 0 ? 0 : input.regressionCorrect / input.regressionCases;
  const requirements = {
    regression_behavior: {
      actual_correct: input.regressionCorrect,
      required_correct: input.regressionCases,
      total: input.regressionCases,
      actual_accuracy: regressionBehaviorAccuracy,
      required_accuracy: 1,
      passed: input.regressionCorrect === input.regressionCases,
    },
    regression_no_answer_recall: {
      actual: input.regressionNoAnswerRecall,
      required: 1,
      passed: input.regressionNoAnswerRecall === 1,
    },
    regression_failures: {
      actual: input.failureGroups.regression_failures.length,
      required: 0,
      passed: input.failureGroups.regression_failures.length === 0,
    },
    dev_failures: {
      actual: input.failureGroups.dev_failures.length,
      required: 0,
      passed: input.failureGroups.dev_failures.length === 0,
    },
    conversation_failures: {
      actual: input.failureGroups.conversation_failures.length,
      required: 0,
      passed: input.failureGroups.conversation_failures.length === 0,
    },
    safety_failures: {
      actual: input.failureGroups.safety_failures.length,
      required: 0,
      passed: input.failureGroups.safety_failures.length === 0,
    },
    stale_context_leakage: {
      actual: input.staleContextLeakageRate,
      required: 0,
      passed: input.staleContextLeakageRate === 0,
    },
  };
  const failureReasons = [
    ...(!requirements.regression_behavior.passed ? ["regression_behavior_below_required"] : []),
    ...(!requirements.regression_no_answer_recall.passed ? ["regression_no_answer_recall_below_required"] : []),
    ...(!requirements.regression_failures.passed ? ["regression_failures_present"] : []),
    ...(!requirements.dev_failures.passed ? ["dev_failures_present"] : []),
    ...(!requirements.conversation_failures.passed ? ["conversation_failures_present"] : []),
    ...(!requirements.safety_failures.passed ? ["safety_failures_present"] : []),
    ...(!requirements.stale_context_leakage.passed ? ["stale_context_leakage_present"] : []),
  ];

  return {
    status: failureReasons.length === 0 ? "passed" as const : "failed" as const,
    passed: failureReasons.length === 0,
    requirements,
    failure_reasons: failureReasons,
  };
}

export function resolveReleaseGate(input: {
  qualityGatePassed: boolean;
  humanReviewComplete: boolean;
}): "blocked_quality_gate" | "blocked_pending_human_review" | "ready_for_release" {
  if (!input.qualityGatePassed) return "blocked_quality_gate";
  if (!input.humanReviewComplete) return "blocked_pending_human_review";
  return "ready_for_release";
}
