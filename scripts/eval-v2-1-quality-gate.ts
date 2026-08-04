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
  regressionBehaviorAccuracy: number;
  regressionNoAnswerRecall: number;
  regressionFailures: string[];
}) {
  const requirements = {
    regression_behavior: {
      actual_correct: Math.round(input.regressionBehaviorAccuracy * input.regressionCases),
      required_correct: input.regressionCases,
      total: input.regressionCases,
      actual_accuracy: input.regressionBehaviorAccuracy,
      required_accuracy: 1,
      passed: input.regressionBehaviorAccuracy === 1,
    },
    regression_no_answer_recall: {
      actual: input.regressionNoAnswerRecall,
      required: 1,
      passed: input.regressionNoAnswerRecall === 1,
    },
    regression_failures: {
      actual: input.regressionFailures.length,
      required: 0,
      passed: input.regressionFailures.length === 0,
    },
  };
  const failureReasons = [
    ...(!requirements.regression_behavior.passed ? ["regression_behavior_not_13_of_13"] : []),
    ...(!requirements.regression_no_answer_recall.passed ? ["regression_no_answer_recall_below_1"] : []),
    ...(!requirements.regression_failures.passed ? ["regression_failures_present"] : []),
  ];

  return {
    status: failureReasons.length === 0 ? "passed" as const : "failed" as const,
    passed: failureReasons.length === 0,
    requirements,
    failure_reasons: failureReasons,
  };
}
