import { IncomingMessage, Server, ServerResponse, createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { AppError } from '../errors';
import { AppService, serializeAnalysis } from '../app';

type Json = Record<string, unknown>;

interface RouteContext {
  service: AppService;
  params: Map<string, string>;
  query: URLSearchParams;
  body: Json;
}

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: (ctx: RouteContext) => unknown;
}

function route(method: string, path: string, handler: (ctx: RouteContext) => unknown): Route {
  const paramNames: string[] = [];
  const regex = new RegExp(
    `^${path.replace(/:([A-Za-z]+)/g, (_match, name: string) => {
      paramNames.push(name);
      return '([0-9]+)';
    })}$`,
  );
  return { method, pattern: regex, paramNames, handler };
}

export function createHttpApp(service: AppService): Server {
  const routes: Route[] = [
    route('GET', '/api/health', () => ({ status: 'ok' })),
    route('POST', '/api/analyses', (ctx) => {
      const analysis = service.createAnalysis(ctx.body as unknown as { colors: unknown; slots: unknown });
      return serializeAnalysis(analysis);
    }),
    route('GET', '/api/analyses', () => ({ analyses: service.listAnalyses() })),
    route('GET', '/api/analyses/:id', (ctx) =>
      serializeAnalysis(service.getAnalysis(Number(ctx.params.get('id')))),
    ),
    route('POST', '/api/feedback', (ctx) => {
      const result = service.feedbackForPair(
        ctx.body as unknown as Parameters<AppService['feedbackForPair']>[0],
      );
      return {
        rules: result.rules,
        guess: result.guess,
        answer: result.answer,
        black: result.feedback.black,
        white: result.feedback.white,
      };
    }),
    route('POST', '/api/analyses/:id/records', (ctx) => {
      const id = Number(ctx.params.get('id'));
      const { analysis, outcome } = service.appendFeedback(id, ctx.body as never);
      return { ...outcome, analysis: serializeAnalysis(analysis) };
    }),
    route('POST', '/api/analyses/:id/undo', (ctx) => {
      const id = Number(ctx.params.get('id'));
      const { outcome } = service.undo(id);
      const analysis = service.getAnalysis(id);
      return { ...outcome, analysis: serializeAnalysis(analysis) };
    }),
    route('GET', '/api/analyses/:id/candidates', (ctx) =>
      service.pageCandidates(Number(ctx.params.get('id')), {
        offset: ctx.query.get('offset') ?? undefined,
        limit: ctx.query.get('limit') ?? undefined,
      }),
    ),
    route('GET', '/api/analyses/:id/suggestion', (ctx) =>
      service.suggestion(Number(ctx.params.get('id')), {
        guessBudget: ctx.query.get('guessBudget') ?? undefined,
        feedbackBudget: ctx.query.get('feedbackBudget') ?? undefined,
      }),
    ),
    route('GET', '/api/analyses/:id/history', (ctx) =>
      service.exportHistory(Number(ctx.params.get('id'))),
    ),
  ];

  return createServer((req: IncomingMessage, res: ServerResponse) => {
    void handle(req, res).catch((err: unknown) => {
      sendError(res, err);
    });

    async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (!url.pathname.startsWith('/api/')) {
        sendJson(response, 404, {
          error: { code: 'NOT_FOUND', message: '仅提供 /api 下的后端接口' },
        });
        return;
      }
      for (const routeEntry of routes) {
        if (routeEntry.method !== request.method) continue;
        const match = routeEntry.pattern.exec(url.pathname);
        if (!match) continue;
        const params = new Map<string, string>();
        routeEntry.paramNames.forEach((name, index) => params.set(name, match[index + 1]));
        let body: Json = {};
        if (request.method === 'POST') {
          body = await readJsonBody(request);
        }
        const payload = routeEntry.handler({ service, params, query: url.searchParams, body });
        sendJson(response, 200, { data: payload });
        return;
      }
      sendJson(response, 404, { error: { code: 'NOT_FOUND', message: '接口不存在' } });
    }
  });
}

function readJsonBody(req: IncomingMessage): Promise<Json> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(new AppError('BAD_REQUEST', '请求体超过 1MB 限制'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          reject(new AppError('INVALID_JSON', '请求体必须是 JSON 对象'));
          return;
        }
        resolve(parsed as Json);
      } catch {
        reject(new AppError('INVALID_JSON', '请求体不是合法 JSON'));
      }
    });
    req.on('error', () => reject(new AppError('BAD_REQUEST', '读取请求体失败')));
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendError(res: ServerResponse, err: unknown): void {
  if (err instanceof AppError) {
    sendJson(res, err.httpStatus, {
      error: { code: err.code, message: err.message, details: err.details ?? null },
    });
    return;
  }
  const message = err instanceof Error ? err.message : '未知内部错误';
  sendJson(res, 500, { error: { code: 'INTERNAL', message } });
}

export async function listenOnFreePort(server: Server, preferredPort?: number): Promise<number> {
  const port = preferredPort ?? 0;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
  const address = server.address() as AddressInfo;
  return address.port;
}
