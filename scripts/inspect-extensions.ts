import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createRaindropPiAgent } from "@raindrop-ai/pi-agent";
import { initPiLocalRagSchema, openPiLocalRagDb, piLocalRagSha256 } from "@policy/rag/index";

type PackageManifest = {
  name: string;
  version: string;
  license?: string;
  repository?: { url?: string } | string;
  peerDependencies?: Record<string, string>;
  pi?: { extensions?: string[] };
};

const expected = new Map([
  ["pi-local-rag", "0.4.1"],
  ["@raindrop-ai/pi-agent", "0.1.0"],
  ["@kkkiio/pi-web-ui", "0.1.1"],
]);

async function manifest(name: string): Promise<PackageManifest> {
  const packagePath = resolve("node_modules", ...name.split("/"), "package.json");
  return JSON.parse(await readFile(packagePath, "utf8")) as PackageManifest;
}

async function verifyRag(): Promise<Record<string, unknown>> {
  const temp = await mkdtemp(join(process.cwd(), ".extension-smoke-rag-"));
  const database = openPiLocalRagDb(temp);
  try {
    initPiLocalRagSchema(database);
    const content = "北京市 北京 育儿补贴 育儿 补贴 金额 3600 元";
    database
      .prepare(`
        INSERT INTO chunks(
          id, file_path, chunk_content, line_start, line_end,
          chunk_hash, indexed_at, tokens
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run("smoke-chunk", "registered://smoke.md", content, 1, 1, piLocalRagSha256(content), new Date().toISOString(), 8);
    const hit = database
      .prepare(`
        SELECT c.chunk_content AS content, bm25(chunks_fts) AS score
        FROM chunks_fts
        JOIN chunks c ON c.rowid = chunks_fts.rowid
        WHERE chunks_fts MATCH ?
        ORDER BY score ASC
        LIMIT 1
      `)
      .get("北京市 AND 育儿补贴") as { content?: string; score?: number } | undefined;
    const vectorRows = database.prepare("SELECT COUNT(*) AS count FROM chunks_vec").get() as { count: number };
    if (!hit?.content?.includes("3600") || vectorRows.count !== 0) {
      throw new Error("pi-local-rag FTS5 smoke query did not return the expected pure-BM25 row");
    }
    return { fts5_hit: true, vector_rows: vectorRows.count, bm25_score: hit.score };
  } finally {
    database.close();
    await rm(temp, { recursive: true, force: true });
  }
}

async function verifyRaindrop(): Promise<Record<string, unknown>> {
  const listeners: Array<(event: unknown) => void> = [];
  const fakeAgent = {
    subscribe(listener: (event: unknown) => void) {
      listeners.push(listener);
      return () => undefined;
    },
  };
  const client = createRaindropPiAgent({
    traces: { enabled: false },
    events: { enabled: false },
    localWorkshopUrl: null,
  });
  const unsubscribe = client.subscribe(fakeAgent as never, {
    userId: "anonymous-smoke",
    convoId: "extension-smoke",
  });
  unsubscribe();
  await client.shutdown();
  if (listeners.length !== 1) throw new Error("Raindrop subscriber was not registered");
  return { subscriber_registered: true, shutdown_completed: true };
}

async function verifyWebUi(): Promise<Record<string, unknown>> {
  const dist = resolve("node_modules/@kkkiio/pi-web-ui/dist");
  const html = await readFile(join(dist, "index.html"), "utf8");
  const mirrorSource = await readFile(
    resolve("node_modules/@kkkiio/pi-web-ui/extensions/mirror-server.ts"),
    "utf8",
  );
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(html);
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Unable to resolve smoke server port");
    const response = await fetch(`http://127.0.0.1:${address.port}`);
    if (!response.ok || !(await response.text()).includes("<div id=\"root\">")) {
      throw new Error("Published pi-web-ui assets did not start");
    }
    if (!mirrorSource.includes("new WebSocketServer") || !mirrorSource.includes('type: "event"')) {
      throw new Error("Published pi-web-ui WebSocket/Pi event bridge was not found");
    }
    return { page_started: true, websocket_bridge_present: true, host: "127.0.0.1" };
  } finally {
    await new Promise<void>((resolveClose, reject) => {
      server.close((error) => (error ? reject(error) : resolveClose()));
    });
  }
}

const manifests: PackageManifest[] = [];
for (const [name, version] of expected) {
  const current = await manifest(name);
  if (current.version !== version) {
    throw new Error(`${name}: expected ${version}, installed ${current.version}`);
  }
  manifests.push(current);
}

const result = {
  packages: manifests.map((item) => ({
    name: item.name,
    version: item.version,
    license: item.license ?? "unknown",
    peers: item.peerDependencies ?? {},
    pi_extensions: item.pi?.extensions ?? [],
  })),
  pi_local_rag: await verifyRag(),
  raindrop: await verifyRaindrop(),
  pi_web_ui: await verifyWebUi(),
};

console.log(JSON.stringify(result, null, 2));
