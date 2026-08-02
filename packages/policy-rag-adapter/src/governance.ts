import { getAdministrativeRegion, isRegionAncestor } from "./region-registry.js";
import type { IntakeAuditRecord } from "./intake-audit.js";

export type NationwideMetadataOverride = {
  document_id: string;
  title: string;
  region: string;
  region_code: string;
  region_level: "national" | "province" | "prefecture" | "county";
  parent_region_code: string | null;
  applicable_region_codes: string[];
  authority: string;
  publish_date: string;
  effective_from: string;
  effective_to: string | null;
  status: "effective" | "expired" | "draft" | "unknown";
  source_url: string;
  policy_type: string;
  version_group: string;
  version_priority: number;
  review_status: "approved" | "quarantined";
  quarantine_reasons: string[];
  source_sha256: string;
};

export type GovernanceValidation = {
  valid: boolean;
  files: number;
  approved: number;
  quarantined: number;
  metadata_complete: number;
  region_resolved: number;
  errors: string[];
};

export function validateGovernanceSnapshot(
  audit: IntakeAuditRecord[],
  overrides: Record<string, NationwideMetadataOverride>,
): GovernanceValidation {
  const errors: string[] = [];
  const auditPaths = new Set(audit.map((record) => record.relative_path));
  for (const key of Object.keys(overrides)) if (!auditPaths.has(key)) errors.push(`${key}: override has no audited source`);
  let metadataComplete = 0;
  let regionResolved = 0;
  for (const record of audit) {
    const override = overrides[record.relative_path];
    if (!override) {
      errors.push(`${record.relative_path}: missing override`);
      continue;
    }
    const required = [override.document_id, override.title, override.region, override.region_code, override.authority,
      override.publish_date, override.effective_from, override.source_url, override.policy_type, override.version_group];
    if (required.every((value) => typeof value === "string" && value.length > 0 && value !== "unknown")) metadataComplete += 1;
    else errors.push(`${record.relative_path}: incomplete metadata`);
    if (override.source_sha256 !== record.sha256) errors.push(`${record.relative_path}: source hash mismatch`);
    const region = getAdministrativeRegion(override.region_code);
    if (region && region.name === override.region && region.level === override.region_level && region.parent_code === override.parent_region_code) {
      regionResolved += 1;
    } else {
      errors.push(`${record.relative_path}: inconsistent region metadata`);
    }
    if (override.applicable_region_codes.length === 0
      || override.applicable_region_codes.some((code) => !getAdministrativeRegion(code) || !isRegionAncestor(override.region_code, code))) {
      errors.push(`${record.relative_path}: invalid applicable region hierarchy`);
    }
    if (override.review_status === "approved" && (override.status === "unknown" || override.quarantine_reasons.length > 0)) {
      errors.push(`${record.relative_path}: invalid approved state`);
    }
    if (override.review_status === "quarantined" && override.quarantine_reasons.length === 0) {
      errors.push(`${record.relative_path}: quarantine reason required`);
    }
  }
  const values = Object.values(overrides);
  return {
    valid: errors.length === 0 && metadataComplete === audit.length && regionResolved === audit.length,
    files: audit.length,
    approved: values.filter((item) => item.review_status === "approved").length,
    quarantined: values.filter((item) => item.review_status === "quarantined").length,
    metadata_complete: metadataComplete,
    region_resolved: regionResolved,
    errors,
  };
}
