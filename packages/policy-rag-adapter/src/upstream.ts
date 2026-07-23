import type Database from "better-sqlite3";

type PiLocalRagPublicApi = {
  openDb(ragDir?: string): Database.Database;
  initSchema(database: Database.Database): void;
  sha256(content: string): string;
};

// pi-local-rag 0.4.1 exports raw TypeScript. A variable dynamic import keeps the
// consumer compiler from type-checking upstream sources while still loading the
// audited public package root at runtime.
const packageName: string = "pi-local-rag";
const upstream = (await import(packageName)) as PiLocalRagPublicApi;

export const openPiLocalRagDb = upstream.openDb;
export const initPiLocalRagSchema = upstream.initSchema;
export const piLocalRagSha256 = upstream.sha256;

