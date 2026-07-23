import type { EvidenceItem, PolicyMetadata } from "@policy/schemas/index";

export type PolicyDocument = {
  metadata: PolicyMetadata;
  fileName: string;
  sourcePath: string;
  body: string;
  raw: string;
  bodyStartLine: number;
  fileHash: string;
};

export type PolicyChunk = {
  document_id: string;
  chunk_id: string;
  title: string;
  content: string;
  section_path: string[];
  line_start: number;
  line_end: number;
  ordinal: number;
};

export interface PolicyChunker {
  chunk(document: PolicyDocument): PolicyChunk[];
}

export interface SearchTextProcessor {
  indexText(text: string): string;
  queryText(text: string): string;
  queryTerms(text: string): string[];
}

export type SearchPolicyInput = {
  query: string;
  region: "北京市" | "河北省" | "对比";
  effective_date: string;
  top_k: number;
};

export type PolicySearchResult = EvidenceItem & {
  metadata: PolicyMetadata;
  line_start: number;
  line_end: number;
};

export type PolicySource = {
  document_id: string;
  chunk_id: string | null;
  title: string;
  section_path: string[];
  content: string;
  source_url: string;
};

export type PolicyVersionResolution =
  | { status: "resolved"; policies: PolicyMetadata[] }
  | { status: "not_found"; policies: [] }
  | { status: "conflict"; policies: PolicyMetadata[]; conflict_groups: string[] };

export interface RetrievalProvider {
  search(input: SearchPolicyInput): Promise<PolicySearchResult[]>;
  getSource(id: string): Promise<PolicySource | null>;
  getMetadata(id: string): Promise<PolicyMetadata | null>;
  resolvePolicyVersion(input: {
    region: "北京市" | "河北省";
    policy_type: string;
    reference_date: string;
  }): Promise<PolicyVersionResolution>;
}

export type IndexBuildReport = {
  documents_total: number;
  documents_indexed: number;
  documents_unchanged: number;
  documents_removed: number;
  chunks_total: number;
  vector_rows: number;
  built_at: string;
};

