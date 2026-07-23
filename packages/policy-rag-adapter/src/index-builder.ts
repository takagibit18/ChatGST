import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type Database from "better-sqlite3";
import { estimateTokens } from "@policy/shared/index";
import { openPiLocalRagDb } from "./upstream.js";
import type { SearchTextProcessor, IndexBuildReport, PolicyChunker, PolicyDocument } from "./types.js";

export type BuildIndexOptions = {
  indexDir: string;
  documents: PolicyDocument[];
  chunker: PolicyChunker;
  textProcessor: SearchTextProcessor;
  rebuild?: boolean;
  now?: () => Date;
};

export function ensurePolicySchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS policy_documents (
      document_id TEXT PRIMARY KEY,
      source_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      title TEXT NOT NULL,
      region TEXT NOT NULL,
      authority TEXT NOT NULL,
      publish_date TEXT NOT NULL,
      effective_from TEXT NOT NULL,
      effective_to TEXT,
      status TEXT NOT NULL,
      source_url TEXT NOT NULL,
      policy_type TEXT NOT NULL,
      version_group TEXT NOT NULL,
      version_priority INTEGER NOT NULL DEFAULT 0,
      indexed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS policy_chunks (
      chunk_id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES policy_documents(document_id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL,
      original_content TEXT NOT NULL,
      section_path TEXT NOT NULL,
      line_start INTEGER NOT NULL,
      line_end INTEGER NOT NULL,
      UNIQUE(document_id, ordinal)
    );

    CREATE INDEX IF NOT EXISTS policy_documents_region_dates
      ON policy_documents(region, status, effective_from, effective_to);
    CREATE INDEX IF NOT EXISTS policy_chunks_document
      ON policy_chunks(document_id, ordinal);
  `);
}

function registeredUri(documentId: string): string {
  return `policy://${encodeURIComponent(documentId)}`;
}

function removeDocument(database: Database.Database, documentId: string): void {
  const ids = database.prepare("SELECT chunk_id FROM policy_chunks WHERE document_id = ?").all(documentId) as Array<{
    chunk_id: string;
  }>;
  const deleteUpstream = database.prepare("DELETE FROM chunks WHERE id = ?");
  for (const { chunk_id: chunkId } of ids) deleteUpstream.run(chunkId);
  database.prepare("DELETE FROM policy_documents WHERE document_id = ?").run(documentId);
  database.prepare("DELETE FROM files WHERE path = ?").run(registeredUri(documentId));
}

export async function buildPolicyIndex(options: BuildIndexOptions): Promise<IndexBuildReport> {
  const indexDir = resolve(options.indexDir);
  await mkdir(indexDir, { recursive: true });
  const database = openPiLocalRagDb(indexDir);
  const now = (options.now ?? (() => new Date()))().toISOString();
  try {
    ensurePolicySchema(database);
    const report = {
      indexed: 0,
      unchanged: 0,
      removed: 0,
      chunks: 0,
    };
    const transaction = database.transaction(() => {
      if (options.rebuild) {
        const existing = database.prepare("SELECT document_id FROM policy_documents").all() as Array<{
          document_id: string;
        }>;
        for (const item of existing) removeDocument(database, item.document_id);
      }

      const incomingIds = new Set(options.documents.map((document) => document.metadata.document_id));
      const existingRows = database.prepare("SELECT document_id, file_hash FROM policy_documents").all() as Array<{
        document_id: string;
        file_hash: string;
      }>;
      for (const existing of existingRows) {
        if (!incomingIds.has(existing.document_id)) {
          removeDocument(database, existing.document_id);
          report.removed += 1;
        }
      }

      const findExisting = database.prepare(
        "SELECT file_hash FROM policy_documents WHERE document_id = ?",
      );
      const insertDocument = database.prepare(`
        INSERT INTO policy_documents(
          document_id, source_path, file_name, file_hash, title, region, authority,
          publish_date, effective_from, effective_to, status, source_url,
          policy_type, version_group, version_priority, indexed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertChunk = database.prepare(`
        INSERT INTO chunks(
          id, file_path, chunk_content, line_start, line_end,
          chunk_hash, indexed_at, tokens
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertPolicyChunk = database.prepare(`
        INSERT INTO policy_chunks(
          chunk_id, document_id, ordinal, original_content,
          section_path, line_start, line_end
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const upsertFile = database.prepare(`
        INSERT OR REPLACE INTO files(path, hash, chunks, indexed, size, embedded)
        VALUES (?, ?, ?, ?, ?, 0)
      `);

      for (const document of options.documents) {
        const existing = findExisting.get(document.metadata.document_id) as { file_hash: string } | undefined;
        if (!options.rebuild && existing?.file_hash === document.fileHash) {
          report.unchanged += 1;
          const count = database
            .prepare("SELECT COUNT(*) AS count FROM policy_chunks WHERE document_id = ?")
            .get(document.metadata.document_id) as { count: number };
          report.chunks += count.count;
          continue;
        }
        if (existing) removeDocument(database, document.metadata.document_id);
        const metadata = document.metadata;
        insertDocument.run(
          metadata.document_id,
          document.sourcePath,
          document.fileName,
          document.fileHash,
          metadata.title,
          metadata.region,
          metadata.authority,
          metadata.publish_date,
          metadata.effective_from,
          metadata.effective_to,
          metadata.status,
          metadata.source_url,
          metadata.policy_type,
          metadata.version_group,
          metadata.version_priority,
          now,
        );
        const chunks = options.chunker.chunk(document);
        for (const chunk of chunks) {
          const searchText = options.textProcessor.indexText(`${chunk.section_path.join(" ")}\n${chunk.content}`);
          insertChunk.run(
            chunk.chunk_id,
            registeredUri(metadata.document_id),
            searchText,
            chunk.line_start,
            chunk.line_end,
            document.fileHash,
            now,
            estimateTokens(searchText),
          );
          insertPolicyChunk.run(
            chunk.chunk_id,
            metadata.document_id,
            chunk.ordinal,
            chunk.content,
            JSON.stringify(chunk.section_path),
            chunk.line_start,
            chunk.line_end,
          );
        }
        upsertFile.run(
          registeredUri(metadata.document_id),
          document.fileHash,
          chunks.length,
          now,
          Buffer.byteLength(document.raw),
        );
        report.indexed += 1;
        report.chunks += chunks.length;
      }
      database.prepare("INSERT OR REPLACE INTO metadata(key, value) VALUES ('last_build', ?)").run(now);
      database
        .prepare("INSERT OR REPLACE INTO metadata(key, value) VALUES ('retrieval_mode', 'bm25-only')")
        .run();
    });
    transaction();
    const vectors = database.prepare("SELECT COUNT(*) AS count FROM chunks_vec").get() as { count: number };
    if (vectors.count !== 0) throw new Error(`Pure BM25 invariant failed: chunks_vec contains ${vectors.count} rows`);
    return {
      documents_total: options.documents.length,
      documents_indexed: report.indexed,
      documents_unchanged: report.unchanged,
      documents_removed: report.removed,
      chunks_total: report.chunks,
      vector_rows: vectors.count,
      built_at: now,
    };
  } finally {
    database.close();
  }
}
