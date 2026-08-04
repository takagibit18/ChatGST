export type CalibrationCandidate = {
  threshold: number;
  macro_recall: number;
  no_answer_f1: number;
  answer_recall: number;
  no_answer_recall: number;
};

export const minimumNoAnswerRecall = 1;

export function selectCalibrationCandidate(candidates: CalibrationCandidate[]) {
  const eligible = candidates.filter((candidate) => candidate.no_answer_recall >= minimumNoAnswerRecall)
    .sort((left, right) => right.answer_recall - left.answer_recall
      || right.macro_recall - left.macro_recall
      || right.no_answer_f1 - left.no_answer_f1
      || left.threshold - right.threshold);
  return {
    calibration_status: eligible.length > 0 ? "passed" as const : "failed" as const,
    constraints: { minimum_no_answer_recall: minimumNoAnswerRecall },
    eligible_candidate_count: eligible.length,
    selected: eligible[0] ?? null,
    failure_reasons: eligible.length > 0 ? [] : ["calibration_constraints_not_met"],
  };
}
