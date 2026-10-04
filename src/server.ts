// HTTP API：仅使用 Node 内置 http，无外部依赖。
import * as http from "node:http";
import * as net from "node:net";
import * as path from "node:path";
import {
  ApiError,
  DEFAULT_SUGGEST_BUDGET,
  MAX_PAGE_LIMIT,
  Rules,
  computeFeedback,
  suggestNext,
  validateSequence,
} from "./core";
import { Store } from "./store";

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body, null, 2);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(data);
}

function sendError(res: http.ServerResponse, e: unknown): void {
  if (e instanceof ApiError) {
    send(res, e.status, { error: { code: e.code, message: e.message } });
  } else {
    send(res, 500, { error: { code: "INTERNAL", message: String(e) } });
  }
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiError("BAD_JSON", "请求体不是合法 JSON");
  }
}

export function createServer(store: Store): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean);
      const method = req.method ?? "GET";

      if (method === "POST" && url.pathname === "/analyses") {
        const body = (await readBody(req)) as { rules: Rules };
        send(res, 201, store.createAnalysis(body?.rules));
        return;
      }
      if (method === "POST" && url.pathname === "/feedback") {
        const body = (await readBody(req)) as { rules: Rules; secret: number[]; guess: number[] };
        const rules = body?.rules;
        validateSequence(body?.secret, rules, "secret");
        validateSequence(body?.guess, rules, "guess");
        send(res, 200, computeFeedback(body.secret, body.guess));
        return;
      }
      if (parts[0] === "analyses" && parts[1]) {
        const id = parts[1];
        if (method === "GET" && parts.length === 2) {
          send(res, 200, { ...store.getAnalysis(id), records: store.listRecords(id) });
          return;
        }
        if (method === "POST" && parts[2] === "records") {
          const body = (await readBody(req)) as { guess: number[]; feedback: unknown };
          send(res, 201, store.appendRecord(id, body?.guess, body?.feedback));
          return;
        }
        if (method === "POST" && parts[2] === "undo") {
          send(res, 200, store.undoLast(id));
          return;
        }
        if (method === "GET" && parts[2] === "candidates") {
          const offset = Math.max(0, parseInt(url.searchParams.get("offset") ?? "0", 10) || 0);
          const limitRaw = parseInt(url.searchParams.get("limit") ?? "100", 10) || 100;
          const limit = Math.min(Math.max(1, limitRaw), MAX_PAGE_LIMIT);
          send(res, 200, { offset, limit, ...store.pageCandidates(id, offset, limit) });
          return;
        }
        if (method === "GET" && parts[2] === "suggestion") {
          const budgetRaw = parseInt(url.searchParams.get("budget") ?? "", 10);
          const budget = Number.isFinite(budgetRaw) && budgetRaw > 0 ? budgetRaw : DEFAULT_SUGGEST_BUDGET;
          send(res, 200, { budget, ...suggestNext(store.loadCandidates(id), budget) });
          return;
        }
        if (method === "GET" && parts[2] === "export") {
          send(res, 200, { ...store.getAnalysis(id), records: store.listRecords(id) });
          return;
        }
      }
      throw new ApiError("NOT_FOUND", `未知路由 ${method} ${url.pathname}`, 404);
    } catch (e) {
      sendError(res, e);
    }
  });
}

export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

async function main(): Promise<void> {
  const dataDir = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
  const store = new Store(path.join(dataDir, "mastermind.db"));
  let port = process.env.PORT ? parseInt(process.env.PORT, 10) : 0;
  if (!port) port = await findFreePort();
  const server = createServer(store);
  server.listen(port, "127.0.0.1", () => {
    const addr = server.address();
    const p = typeof addr === "object" && addr ? addr.port : port;
    console.log(`Mastermind API 已启动: http://127.0.0.1:${p}  数据目录: ${dataDir}`);
  });
}

if (require.main === module) {
  void main();
}
