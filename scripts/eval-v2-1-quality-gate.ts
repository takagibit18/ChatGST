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
  calibrationPassed?: boolean;
  calibrationAnswerRecall: number;
}) {
  const regressionBehaviorAccuracy = input.regressionCases === 0 ? 0 : input.regressionCorrect / input.regressionCases;
  const requirements = {
    calibration_constraints: {
      actual: input.calibrationPassed !== false,
      required: true,
      passed: input.calibrationPassed !== false,
    },
    calibration_answer_recall: {
      actual: input.calibrationAnswerRecall,
      required: 0.8,
      passed: input.calibrationAnswerRecall >= 0.8,
    },
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
    ...(!requirements.calibration_constraints.passed ? ["calibration_constraints_not_met"] : []),
    ...(!requirements.calibration_answer_recall.passed ? ["answer_recall_below_required"] : []),
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

export function resolvePhase4EntryGate(input: {
  qualityGatePassed: boolean;
  datasetReviewGate: string;
  artifactConsistencyPassed: boolean;
  determinismPassed: boolean;
  requiredTestsPassed: boolean;
  testSplitStatus: string;
}): "blocked_dataset_review" | "blocked_quality_gate" | "blocked_artifact_mismatch" | "ready_for_phase4" {
  if (input.datasetReviewGate !== "human_review_passed") return "blocked_dataset_review";
  if (!input.qualityGatePassed) return "blocked_quality_gate";
  if (!input.artifactConsistencyPassed || !input.determinismPassed || !input.requiredTestsPassed) return "blocked_artifact_mismatch";
  if (input.testSplitStatus !== "not_frozen") return "blocked_artifact_mismatch";
  return "ready_for_phase4";
}

export function resolveProductionReleaseGate(input: {
  phase4Complete: boolean;
  frozenTestExecuted: boolean;
  realModelEvalPassed: boolean;
  qualityGatePassed: boolean;
}): "blocked_pending_phase4" | "blocked_pending_frozen_test" | "blocked_pending_real_model_eval" | "blocked_quality_gate" | "ready_for_production_candidate" {
  if (!input.qualityGatePassed) return "blocked_quality_gate";
  if (!input.phase4Complete) return "blocked_pending_phase4";
  if (!input.frozenTestExecuted) return "blocked_pending_frozen_test";
  if (!input.realModelEvalPassed) return "blocked_pending_real_model_eval";
  return "ready_for_production_candidate";
}
