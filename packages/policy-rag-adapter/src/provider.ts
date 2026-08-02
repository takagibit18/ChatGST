import { resolve } from "node:path";
import type Database from "better-sqlite3";
import { policyMetadataSchema, type PolicyMetadata } from "@policy/schemas/index";
import { PolicyAssistantError } from "@policy/shared/index";
import { ensurePolicySchema } from "./index-builder.js";
import { openPiLocalRagDb } from "./upstream.js";
import { ChinesePolicySearchTextProcessor, toFtsQuery } from "./chinese-search.js";
import type {
  KnowledgeDocumentDetail,
  KnowledgeDocumentSummary,
  PolicySearchResult,
  PolicySource,
  PolicyVersionResolution,
  RetrievalProvider,
  SearchPolicyInput,
  SearchTextProcessor,
} from "./types.js";
import type { SourceFormat } from "./document-extractor.js";

type MetadataRow = {
  document_id: string;
  title: string;
  region: string;
  region_code: string;
  region_level: string;
  parent_region_code: string | null;
  applicable_region_codes: string;
  authority: string;
  publish_date: string;
  effective_from: string;
  effective_to: string | null;
  status: string;
  source_url: string;
  policy_type: string;
  version_group: string;
  version_priority: number;
  review_status: string;
  quarantine_reasons: string;
};

type SearchRow = MetadataRow & {
  chunk_id: string;
  original_content: string;
  section_path: string;
  line_start: number;
  line_end: number;
  bm25_score: number;
};

type KnowledgeSummaryRow = MetadataRow & {
  source_format: string;
  extraction_warnings: string;
  indexed_at: string;
  chunks: number;
  characters: number;
};

function metadataFromRow(row: MetadataRow): PolicyMetadata {
  return policyMetadataSchema.parse({
    ...row,
    status: row.status,
    applicable_region_codes: parseStringArray(row.applicable_region_codes),
    quarantine_reasons: parseStringArray(row.quarantine_reasons),
  });
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function assertDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new PolicyAssistantError("INVALID_INPUT", "effective_date must use YYYY-MM-DD");
  }
}

function parseWarnings(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function knowledgeSummaryFromRow(row: KnowledgeSummaryRow): KnowledgeDocumentSummary {
  return {
    metadata: metadataFromRow(row),
    source_format: row.source_format as SourceFormat,
    chunks: row.chunks,
    characters: row.characters,
    extraction_warnings: parseWarnings(row.extraction_warnings),
    indexed_at: row.indexed_at,
  };
}

export class PiLocalRagRetrievalProvider implements RetrievalProvider {
  private readonly indexDir: string;

  constructor(
    indexDir: string,
    private readonly textProcessor: SearchTextProcessor = new ChinesePolicySearchTextProcessor(),
  ) {
    this.indexDir = resolve(indexDir);
  }

  async search(input: SearchPolicyInput): Promise<PolicySearchResult[]> {
    if (!input.query.trim() || input.query.length > 2000) {
      throw new PolicyAssistantError("INVALID_INPUT", "Search query is empty or too long");
    }
    if (input.top_k < 1 || input.top_k > 8) {
      throw new PolicyAssistantError("INVALID_INPUT", "top_k must be between 1 and 8");
    }
    assertDate(input.effective_date);
    const contentQuery = input.query.replace(/北京市?|河北省?/gu, " ");
    const ftsQuery = toFtsQuery(this.textProcessor.queryTerms(contentQuery));
    if (!ftsQuery) return [];
    const database = this.openReadyDatabase();
    try {
      const includeMaternity = /生育津贴|生育保险|产假工资/u.test(input.query) ? 1 : 0;
      const regions = input.region === "对比" ? ["北京市", "河北省", "全国"] : [input.region, "全国"];
      const placeholders = regions.map(() => "?").join(", ");
      const rows = database
        .prepare(`
          SELECT
            pd.document_id, pd.title, pd.region, pd.region_code, pd.region_level,
            pd.parent_region_code, pd.applicable_region_codes, pd.authority, pd.publish_date,
            pd.effective_from, pd.effective_to, pd.status, pd.source_url,
            pd.policy_type, pd.version_group, pd.version_priority, pd.review_status, pd.quarantine_reasons,
            pc.chunk_id, pc.original_content, pc.section_path,
            pc.line_start, pc.line_end, bm25(chunks_fts) AS bm25_score
          FROM chunks_fts
          JOIN chunks c ON c.rowid = chunks_fts.rowid
          JOIN policy_chunks pc ON pc.chunk_id = c.id
          JOIN policy_documents pd ON pd.document_id = pc.document_id
          WHERE chunks_fts MATCH ?
            AND pd.region IN (${placeholders})
            AND (? = 1 OR pd.policy_type = 'childcare-subsidy')
            AND pd.status = 'effective'
            AND pd.effective_from <> 'unknown'
            AND pd.effective_from <= ?
            AND (pd.effective_to IS NULL OR (pd.effective_to <> 'unknown' AND pd.effective_to >= ?))
          ORDER BY bm25_score ASC, pd.version_priority DESC, pd.publish_date DESC
          LIMIT ?
        `)
        .all(ftsQuery, ...regions, includeMaternity, input.effective_date, input.effective_date, input.top_k * 3) as SearchRow[];
      return rows
        .map((row) => {
          const metadata = metadataFromRow(row);
          const regionBoost = row.region === input.region || input.region === "对比" ? 0.01 : 0;
          return {
            document_id: row.document_id,
            chunk_id: row.chunk_id,
            title: row.title,
            region: row.region,
            section_path: JSON.parse(row.section_path) as string[],
            content: row.original_content,
            source_url: row.source_url,
            effective_from: row.effective_from,
            effective_to: row.effective_to,
            status: metadata.status,
            retrieval_score: Number((-row.bm25_score + regionBoost).toFixed(8)),
            metadata,
            line_start: row.line_start,
            line_end: row.line_end,
          } satisfies PolicySearchResult;
        })
        .sort((left, right) => right.retrieval_score - left.retrieval_score)
        .slice(0, input.top_k);
    } finally {
      database.close();
    }
  }

  async getSource(id: string): Promise<PolicySource | null> {
    const database = this.openReadyDatabase();
    try {
      const row = database
        .prepare(`
          SELECT pd.document_id, pd.title, pd.source_url, pc.chunk_id,
                 pc.original_content, pc.section_path
          FROM policy_documents pd
          JOIN policy_chunks pc ON pc.document_id = pd.document_id
          WHERE pd.document_id = ? OR pc.chunk_id = ?
          ORDER BY pc.ordinal ASC
          LIMIT 1
        `)
        .get(id, id) as
        | {
            document_id: string;
            title: string;
            source_url: string;
            chunk_id: string;
            original_content: string;
            section_path: string;
          }
        | undefined;
      return row
        ? {
            document_id: row.document_id,
            chunk_id: row.chunk_id,
            title: row.title,
            section_path: JSON.parse(row.section_path) as string[],
            content: row.original_content,
            source_url: row.source_url,
          }
        : null;
    } finally {
      database.close();
    }
  }

  async getMetadata(id: string): Promise<PolicyMetadata | null> {
    const database = this.openReadyDatabase();
    try {
      const row = database
        .prepare(`
          SELECT pd.document_id, pd.title, pd.region, pd.region_code, pd.region_level,
                 pd.parent_region_code, pd.applicable_region_codes, pd.authority, pd.publish_date,
                 pd.effective_from, pd.effective_to, pd.status, pd.source_url,
                 pd.policy_type, pd.version_group, pd.version_priority, pd.review_status, pd.quarantine_reasons
          FROM policy_documents pd
          LEFT JOIN policy_chunks pc ON pc.document_id = pd.document_id
          WHERE pd.document_id = ? OR pc.chunk_id = ?
          LIMIT 1
        `)
        .get(id, id) as MetadataRow | undefined;
      return row ? metadataFromRow(row) : null;
    } finally {
      database.close();
    }
  }

  async resolvePolicyVersion(input: {
    region: "北京市" | "河北省";
    policy_type: string;
    reference_date: string;
  }): Promise<PolicyVersionResolution> {
    assertDate(input.reference_date);
    const database = this.openReadyDatabase();
    try {
      const rows = database
        .prepare(`
          SELECT document_id, title, region, region_code, region_level,
                 parent_region_code, applicable_region_codes, authority, publish_date,
                 effective_from, effective_to, status, source_url,
                 policy_type, version_group, version_priority, review_status, quarantine_reasons
          FROM policy_documents
          WHERE region = ? AND policy_type = ? AND status = 'effective'
            AND effective_from <> 'unknown' AND effective_from <= ?
            AND (effective_to IS NULL OR (effective_to <> 'unknown' AND effective_to >= ?))
          ORDER BY version_group, version_priority DESC, publish_date DESC
        `)
        .all(input.region, input.policy_type, input.reference_date, input.reference_date) as MetadataRow[];
      if (rows.length === 0) return { status: "not_found", policies: [] };
      const policies = rows.map(metadataFromRow);
      const groups = new Map<string, PolicyMetadata[]>();
      for (const policy of policies) {
        const versionGroup = policy.version_group ?? "unknown";
        const group = groups.get(versionGroup) ?? [];
        group.push(policy);
        groups.set(versionGroup, group);
      }
      const conflictGroups = [...groups.entries()]
        .filter(([, group]) => {
          const max = Math.max(...group.map((policy) => policy.version_priority ?? 0));
          return group.filter((policy) => (policy.version_priority ?? 0) === max).length > 1;
        })
        .map(([group]) => group);
      return conflictGroups.length > 0
        ? { status: "conflict", policies, conflict_groups: conflictGroups }
        : { status: "resolved", policies };
    } finally {
      database.close();
    }
  }

  async listKnowledgeDocuments(input: { region?: string; query?: string } = {}): Promise<KnowledgeDocumentSummary[]> {
    const query = input.query?.trim() ?? "";
    if (query.length > 200) throw new PolicyAssistantError("INVALID_INPUT", "Knowledge query is too long");
    const database = this.openReadyDatabase();
    try {
      const filters: string[] = [];
      const parameters: Array<string> = [];
      if (input.region && input.region !== "全部") {
        filters.push("pd.region = ?");
        parameters.push(input.region);
      }
      if (query) {
        filters.push("(pd.title LIKE ? OR pd.authority LIKE ? OR pd.document_id LIKE ?)");
        const pattern = `%${query}%`;
        parameters.push(pattern, pattern, pattern);
      }
      const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
      const rows = database.prepare(`
        SELECT pd.document_id, pd.title, pd.region, pd.region_code, pd.region_level,
               pd.parent_region_code, pd.applicable_region_codes, pd.authority, pd.publish_date,
               pd.effective_from, pd.effective_to, pd.status, pd.source_url,
               pd.policy_type, pd.version_group, pd.version_priority, pd.review_status, pd.quarantine_reasons,
               pd.source_format, pd.extraction_warnings, pd.indexed_at,
               COUNT(pc.chunk_id) AS chunks,
               COALESCE(SUM(LENGTH(pc.original_content)), 0) AS characters
        FROM policy_documents pd
        LEFT JOIN policy_chunks pc ON pc.document_id = pd.document_id
        ${where}
        GROUP BY pd.document_id
        ORDER BY pd.region, pd.publish_date DESC, pd.title
        LIMIT 100
      `).all(...parameters) as KnowledgeSummaryRow[];
      return rows.map(knowledgeSummaryFromRow);
    } finally {
      database.close();
    }
  }

  async getKnowledgeDocument(documentId: string): Promise<KnowledgeDocumentDetail | null> {
    const database = this.openReadyDatabase();
    try {
      const summary = database.prepare(`
        SELECT pd.document_id, pd.title, pd.region, pd.region_code, pd.region_level,
               pd.parent_region_code, pd.applicable_region_codes, pd.authority, pd.publish_date,
               pd.effective_from, pd.effective_to, pd.status, pd.source_url,
               pd.policy_type, pd.version_group, pd.version_priority, pd.review_status, pd.quarantine_reasons,
               pd.source_format, pd.extraction_warnings, pd.indexed_at,
               COUNT(pc.chunk_id) AS chunks,
               COALESCE(SUM(LENGTH(pc.original_content)), 0) AS characters
        FROM policy_documents pd
        LEFT JOIN policy_chunks pc ON pc.document_id = pd.document_id
        WHERE pd.document_id = ?
        GROUP BY pd.document_id
      `).get(documentId) as KnowledgeSummaryRow | undefined;
      if (!summary) return null;
      const sections = database.prepare(`
        SELECT chunk_id, ordinal, section_path, original_content,
               line_start, line_end
        FROM policy_chunks
        WHERE document_id = ?
        ORDER BY ordinal
      `).all(documentId) as Array<{
        chunk_id: string;
        ordinal: number;
        section_path: string;
        original_content: string;
        line_start: number;
        line_end: number;
      }>;
      return {
        ...knowledgeSummaryFromRow(summary),
        sections: sections.map((section) => ({
          chunk_id: section.chunk_id,
          ordinal: section.ordinal,
          section_path: JSON.parse(section.section_path) as string[],
          content: section.original_content,
          line_start: section.line_start,
          line_end: section.line_end,
        })),
      };
    } finally {
      database.close();
    }
  }

  getStats(): { documents: number; chunks: number; vector_rows: number; retrieval_mode: string } {
    const database = this.openReadyDatabase();
    try {
      const documents = database.prepare("SELECT COUNT(*) AS count FROM policy_documents").get() as { count: number };
      const chunks = database.prepare("SELECT COUNT(*) AS count FROM policy_chunks").get() as { count: number };
      const vectors = database.prepare("SELECT COUNT(*) AS count FROM chunks_vec").get() as { count: number };
      const mode = database.prepare("SELECT value FROM metadata WHERE key = 'retrieval_mode'").get() as
        | { value: string }
        | undefined;
      return {
        documents: documents.count,
        chunks: chunks.count,
        vector_rows: vectors.count,
        retrieval_mode: mode?.value ?? "unknown",
      };
    } finally {
      database.close();
    }
  }

  private openReadyDatabase(): Database.Database {
    const database = openPiLocalRagDb(this.indexDir);
    ensurePolicySchema(database);
    const row = database.prepare("SELECT COUNT(*) AS count FROM policy_documents").get() as { count: number };
    if (row.count === 0) {
      database.close();
      throw new PolicyAssistantError("RAG_NOT_READY", "Policy index contains no documents");
    }
    return database;
  }
}
