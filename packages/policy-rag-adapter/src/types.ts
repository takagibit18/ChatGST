import type { EvidenceItem, PolicyMetadata } from "@policy/schemas/index";
import type { SourceFormat } from "./document-extractor.js";

export type PolicyDocument = {
  metadata: PolicyMetadata;
  fileName: string;
  sourcePath: string;
  body: string;
  raw: string;
  bodyStartLine: number;
  fileHash: string;
  sourceFormat: SourceFormat;
  extractionWarnings: string[];
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
  region: string;
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

export type KnowledgeDocumentSummary = {
  metadata: PolicyMetadata;
  source_format: SourceFormat;
  chunks: number;
  characters: number;
  extraction_warnings: string[];
  indexed_at: string;
};

export type KnowledgeDocumentDetail = KnowledgeDocumentSummary & {
  sections: Array<{
    chunk_id: string;
    ordinal: number;
    section_path: string[];
    content: string;
    line_start: number;
    line_end: number;
  }>;
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
    region: string;
    policy_type: string;
    reference_date: string;
  }): Promise<PolicyVersionResolution>;
  getStats?(): { documents: number; chunks: number; vector_rows: number; retrieval_mode: string; snapshot_hash?: string };
}

export interface KnowledgeBrowserProvider {
  listKnowledgeDocuments(input?: { region?: string; query?: string }): Promise<KnowledgeDocumentSummary[]>;
  getKnowledgeDocument(documentId: string): Promise<KnowledgeDocumentDetail | null>;
  search(input: SearchPolicyInput): Promise<PolicySearchResult[]>;
  getStats(): { documents: number; chunks: number; vector_rows: number; retrieval_mode: string; snapshot_hash?: string };
}

export type IndexBuildReport = {
  documents_total: number;
  documents_indexed: number;
  documents_unchanged: number;
  documents_removed: number;
  chunks_total: number;
  vector_rows: number;
  built_at: string;
  snapshot_hash?: string;
};
