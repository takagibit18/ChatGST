import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import { browserCommandSchema } from "@policy/schemas/index";
import { asPolicyError, type RuntimeConfig } from "@policy/shared/index";
import type { PolicyAgentRuntime } from "@policy/runtime/index";
import { PolicyUiEventAdapter } from "./event-adapter.js";

const mimeTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

export type PolicyServerOptions = {
  runtime: Pick<PolicyAgentRuntime, "answer" | "reset">;
  config: RuntimeConfig;
  staticDir: string;
};

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

export function createPolicyServer(options: PolicyServerOptions) {
  const staticRoot = resolve(options.staticDir);
  const adapter = new PolicyUiEventAdapter();
  const server = createServer(async (request, response) => {
    try {
      await handleHttp(request, response, staticRoot);
    } catch {
      sendJson(response, 500, { status: "error", message: "服务暂时不可用" });
    }
  });
  const websocketServer = new WebSocketServer({ noServer: true, maxPayload: options.config.budget.maxInputLength * 3 });

  server.on("upgrade", (request, socket, head) => {
    const host = request.headers.host ?? "";
    const origin = request.headers.origin;
    const localOrigin = !origin || origin === `http://${host}`;
    if (request.url !== "/ws" || !localOrigin) {
      socket.destroy();
      return;
    }
    websocketServer.handleUpgrade(request, socket, head, (websocket) => {
      websocketServer.emit("connection", websocket, request);
    });
  });

  websocketServer.on("connection", (socket) => {
    let busy = false;
    socket.on("message", async (data, isBinary) => {
      if (isBinary) {
        adapter.send(socket, { type: "safe_error", code: "INVALID_INPUT", message: "不支持二进制消息" });
        return;
      }
      let decoded: unknown;
      try {
        decoded = JSON.parse(data.toString()) as unknown;
      } catch {
        adapter.send(socket, { type: "safe_error", code: "INVALID_INPUT", message: "消息格式无效" });
        return;
      }
      const command = browserCommandSchema.safeParse(decoded);
      if (!command.success) {
        adapter.send(socket, { type: "safe_error", code: "INVALID_INPUT", message: "查询请求不符合要求" });
        return;
      }
      if (command.data.type === "reset") {
        await options.runtime.reset(command.data.conversation_id);
        adapter.send(socket, { type: "session_reset", conversation_id: randomUUID() });
        return;
      }
      if (busy) {
        adapter.send(socket, { type: "safe_error", code: "INVALID_INPUT", message: "上一条查询仍在处理中" });
        return;
      }
      busy = true;
      try {
        const result = await options.runtime.answer({
          conversationId: command.data.conversation_id,
          message: command.data.message,
          onStatus: (event) => adapter.send(socket, event),
        });
        adapter.send(socket, { type: "result", response: result.response });
      } catch (error) {
        const safe = asPolicyError(error);
        adapter.send(socket, { type: "safe_error", code: safe.code, message: safe.safeMessage });
      } finally {
        busy = false;
      }
    });
    socket.on("error", () => undefined);
  });

  return {
    server,
    websocketServer,
    async listen(): Promise<{ host: string; port: number; url: string }> {
      await new Promise<void>((resolveListen, reject) => {
        server.once("error", reject);
        server.listen(options.config.server.port, options.config.server.host, resolveListen);
      });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Unable to resolve server address");
      return { host: options.config.server.host, port: address.port, url: `http://${options.config.server.host}:${address.port}` };
    },
    async close(): Promise<void> {
      for (const client of websocketServer.clients) client.close();
      await new Promise<void>((resolveClose) => websocketServer.close(() => resolveClose()));
      if (!server.listening) return;
      await new Promise<void>((resolveClose, reject) => server.close((error) => (error ? reject(error) : resolveClose())));
    },
  };
}

async function handleHttp(request: IncomingMessage, response: ServerResponse, staticRoot: string): Promise<void> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendJson(response, 405, { status: "error", message: "仅支持读取请求" });
    return;
  }
  const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
  if (requestUrl.pathname === "/healthz") {
    sendJson(response, 200, { status: "ok", service: "childcare-policy-assistant", host: "loopback" });
    return;
  }
  const relative = requestUrl.pathname === "/" ? "index.html" : decodeURIComponent(requestUrl.pathname.slice(1));
  let filePath = resolve(staticRoot, relative);
  if (!filePath.startsWith(`${staticRoot}${sep}`) && filePath !== staticRoot) {
    sendJson(response, 404, { status: "not_found" });
    return;
  }
  try {
    await access(filePath);
  } catch {
    filePath = resolve(staticRoot, "index.html");
  }
  const extension = extname(filePath).toLowerCase();
  response.writeHead(200, {
    "content-type": mimeTypes[extension] ?? "application/octet-stream",
    "cache-control": extension === ".html" ? "no-store" : "public, max-age=31536000, immutable",
    "content-security-policy": "default-src 'self'; connect-src 'self' ws://127.0.0.1:* ws://localhost:*; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  const stream = createReadStream(filePath);
  stream.on("error", async () => {
    if (!response.headersSent) sendJson(response, 500, { status: "error" });
    else response.destroy();
  });
  stream.pipe(response);
}
