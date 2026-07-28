/**
 * 14-server.ts — HTTP 服务入口 (stub)
 *
 * 对应原架构文档 server.ts
 * 桥接到 ChatGST 已有的 HTTP + WebSocket 基础设施
 */
import { createServer } from "node:http";

export interface ServerInstance {
  listen(): Promise<{ host: string; port: number; url: string }>;
  close(): Promise<void>;
}

export async function startServer(): Promise<ServerInstance> {
  const port = parseInt(process.env.ONTO_PORT ?? "3002", 10);
  const host = process.env.ONTO_HOST ?? "127.0.0.1";

  const server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "onto-bridge", version: "0.1.0" }));
  });

  return {
    listen() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          const addr = server.address();
          if (!addr || typeof addr === "string") throw new Error("Unable to resolve server address");
          console.log(`[onto-bridge] server listening at http://${host}:${addr.port}`);
          resolve({ host, port: addr.port, url: `http://${host}:${addr.port}` });
        });
      });
    },
    close() {
      return new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
