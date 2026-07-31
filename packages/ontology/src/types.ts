export type MergeConflictAction = "use_candidate" | "keep_existing" | "skip";

export interface OntoPlatformConfig {
  url: string;
  username: string;
  password: string;
}

export interface RuleEngineConfig extends OntoPlatformConfig {
  policyId?: string;
}

export interface Step2Config {
  default_data_root: string;
  merge_conflict_action?: MergeConflictAction;
}

export interface RegionLevels {
  national?: string | null;
  province_level?: string | null;
  prefecture_level?: string | null;
  county_level?: string | null;
  township_level?: string | null;
}

export interface RegionSelector {
  region_id?: string;
  levels?: RegionLevels;
  national?: string | null;
  province_level?: string | null;
  prefecture_level?: string | null;
  county_level?: string | null;
  township_level?: string | null;
}

export interface ReviewProgress {
  golden_selected: number;
  golden_total: number;
  run_id?: string;
  run_status?: "idle" | "running" | "passed" | "failed";
  run_started_at?: string;
  run_finished_at?: string;
  run_pass_rate?: number;
  run_failed_rules?: string[];
}

export interface MergeSummary {
  merged: number;
  failed: number;
  conflict_count: number;
  conflict_action: MergeConflictAction;
  overwritten_keys: string[];
  blocked_count: number;
  warnings: string[];
  finished_at: string;
  failed_regions: Array<{ region: string; reason: string }>;
}

export interface Step2Error {
  file: string;
  stage: "extract" | "derive" | "merge" | "merge-all";
  message: string;
  at: string;
  candidates?: Array<{ region_id: string; display_name: string; rule_count?: number }>;
}

export interface Step2Progress {
  phase: "idle" | "extract" | "derive" | "merge" | "review" | "done" | "failed";
  total_files: number;
  processed: number;
  current_file?: string;
  current_region?: string;
  started_at?: string;
  finished_at?: string;
  errors: Step2Error[];
  data_source_root?: string;
  review?: ReviewProgress;
  merge_stage?: "preview" | "resolving" | "committing";
  conflict_count?: number;
  merge_summary?: MergeSummary;
}

export interface OntologyMeta {
  policy_id: string;
  canonical_name: string;
  onto_version?: string;
  onto_hash?: string;
  regions: string[];
  started_at: string;
  finished_at: string;
  step_durations: {
    extract_ms: number;
    derive_ms: number;
    merge_ms: number;
    review_ms: number;
    golden_run_ms: number;
  };
  file_count: number;
  rule_count: number;
  golden_pass_rate?: number;
}

export interface PolicyQueryRequest {
  region: string;
  text: string;
  question?: string;
  policy_id?: string;
  version?: string;
  facts?: Record<string, unknown>;
}

export interface MissingField {
  op: string;
  zh?: string;
  hint?: string;
}

export interface PolicyQueryResponse {
  ok?: boolean;
  error?: string;
  region: string;
  eligible: boolean;
  verdict: "eligible" | "missing_info" | "ineligible";
  missing?: MissingField[];
  conclusions?: unknown[];
  evidence?: unknown[];
  version?: string;
}

