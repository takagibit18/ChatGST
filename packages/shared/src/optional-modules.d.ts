declare module "sql.js" {
  const initSqlJs: () => Promise<{ Database: new (data?: Uint8Array) => {
    run(sql: string, params?: unknown[]): void;
    exec(sql: string): unknown;
    export(): Uint8Array;
    close(): void;
  } }>;
  export default initSqlJs;
}

declare module "@xenova/transformers" {
  export function pipeline(task: string, model: string): Promise<unknown>;
}

declare module "jiti/static" {
  export function createJiti(baseUrl: string, options?: Record<string, unknown>): {
    (specifier: string): Promise<unknown>;
    import(specifier: string): Promise<unknown>;
    cache: Record<string, unknown>;
  };
}
