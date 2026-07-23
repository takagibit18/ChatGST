import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createRaindropPiAgent } from "@raindrop-ai/pi-agent";
import { describe, expect, it } from "vitest";
import { initPiLocalRagSchema, openPiLocalRagDb } from "@policy/rag/index";

const expected = {
  "pi-local-rag": "0.4.1",
  "@raindrop-ai/pi-agent": "0.1.0",
  "@kkkiio/pi-web-ui": "0.1.1",
} as const;

describe("audited community extensions", () => {
  it.each(Object.entries(expected))("installs the pinned %s package", async (name, version) => {
    const path = resolve("node_modules", ...name.split("/"), "package.json");
    const manifest = JSON.parse(await readFile(path, "utf8")) as { version: string };
    expect(manifest.version).toBe(version);
  });

  it("loads pi-local-rag public SQLite and FTS5 APIs", async () => {
    const directory = await mkdtemp(join(process.cwd(), ".test-extension-rag-"));
    const database = openPiLocalRagDb(directory);
    try {
      initPiLocalRagSchema(database);
      const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
      expect(tables.map((row) => row.name)).toContain("chunks_fts");
      expect(tables.map((row) => row.name)).toContain("chunks_vec");
    } finally {
      database.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("registers and shuts down the real Raindrop subscriber without a network sink", async () => {
    let subscribers = 0;
    const client = createRaindropPiAgent({ traces: { enabled: false }, events: { enabled: false }, localWorkshopUrl: null });
    const unsubscribe = client.subscribe(
      { subscribe: () => { subscribers += 1; return () => undefined; } } as never,
      { userId: "anonymous-test", convoId: "extension-test" },
    );
    unsubscribe();
    await client.shutdown();
    expect(subscribers).toBe(1);
  });

  it("keeps the upstream web assets and event bridge as the controlled-fork baseline", async () => {
    const html = await readFile(resolve("node_modules/@kkkiio/pi-web-ui/dist/index.html"), "utf8");
    const bridge = await readFile(resolve("node_modules/@kkkiio/pi-web-ui/extensions/mirror-server.ts"), "utf8");
    expect(html).toContain('<div id="root">');
    expect(bridge).toContain("WebSocketServer");
    expect(bridge).toContain('type: "event"');
  });
});
