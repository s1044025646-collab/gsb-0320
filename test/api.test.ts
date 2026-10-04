import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Server } from 'node:http';
import { createHttpApp, listenOnFreePort } from '../src/server/http';
import { AppService } from '../src/app';
import { DEFAULT_LIMITS } from '../src/limits';
import { Store } from '../src/store';

interface ApiResponse<T> {
  data?: T;
  error?: { code: string; message: string };
}

class Harness {
  private constructor(
    readonly base: string,
    private readonly server: Server,
    private readonly store: Store,
    private readonly dir: string,
  ) {}

  static async start(): Promise<Harness> {
    const dir = mkdtempSync(join(tmpdir(), 'mm-api-'));
    const store = new Store(join(dir, 'api.sqlite'), DEFAULT_LIMITS.maxCandidates);
    const service = new AppService(store, DEFAULT_LIMITS);
    const server = createHttpApp(service);
    const port = await listenOnFreePort(server);
    return new Harness(`http://127.0.0.1:${port}`, server, store, dir);
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<{ status: number; json: ApiResponse<T> }> {
    const response = await fetch(this.base + path, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await response.json()) as ApiResponse<T>;
    return { status: response.status, json };
  }

  stop(): void {
    this.server.close();
    this.store.close();
    rmSync(this.dir, { recursive: true, force: true });
  }
}

test('HTTP 全流程：创建、反馈、追加、候选分页、建议、撤销、导出', async () => {
  const harness = await Harness.start();
  try {
    const created = await harness.request<{ id: number; totalCandidates: number }>('POST', '/api/analyses', {
      colors: ['红', '绿', '蓝', '黄'],
      slots: 4,
    });
    assert.equal(created.status, 200);
    const id = created.json.data!.id;
    assert.equal(created.json.data!.totalCandidates, 256);

    const pair = await harness.request<{ black: number; white: number }>('POST', '/api/feedback', {
      colors: ['红', '绿', '蓝', '黄'],
      slots: 4,
      guess: [1, 2, 1, 2],
      answer: [1, 1, 2, 2],
    });
    assert.equal(pair.json.data!.black, 2);
    assert.equal(pair.json.data!.white, 2);

    const appended = await harness.request<{ accepted: boolean }>('POST', `/api/analyses/${id}/records`, {
      guess: [1, 2, 1, 2],
      black: 2,
      white: 2,
    });
    assert.equal(appended.json.data!.accepted, true);

    const page = await harness.request<{ returned: number; hasMore: boolean; total: number }>(
      'GET',
      `/api/analyses/${id}/candidates?offset=0&limit=2`,
    );
    assert.equal(page.json.data!.returned, 2);
    assert.equal(page.json.data!.hasMore, true);

    const conflict = await harness.request<{ accepted: boolean }>('POST', `/api/analyses/${id}/records`, {
      guess: [0, 0, 0, 0],
      feedback: { black: 4, white: 0 },
    });
    assert.equal(conflict.json.data!.accepted, false);

    await harness.request('POST', `/api/analyses/${id}/records`, {
      guess: [1, 1, 2, 2],
      feedback: { black: 4, white: 0 },
    });
    const suggestion = await harness.request<{ status: string }>(
      'GET',
      `/api/analyses/${id}/suggestion`,
    );
    assert.equal(suggestion.json.data!.status, 'unique');

    const history = await harness.request<{ records: unknown[] }>(
      'GET',
      `/api/analyses/${id}/history`,
    );
    assert.equal(history.json.data!.records.length, 2);

    const undo = await harness.request<{ analysis: { remainingCandidates: number } }>(
      'POST',
      `/api/analyses/${id}/undo`,
      {},
    );
    assert.equal(undo.status, 200);
    assert.equal(undo.json.data!.analysis.remainingCandidates, 4);
  } finally {
    harness.stop();
  }
});

test('HTTP 参数校验返回明确错误码', async () => {
  const harness = await Harness.start();
  try {
    const badColors = await harness.request('POST', '/api/analyses', { colors: [], slots: 2 });
    assert.equal(badColors.status, 400);
    assert.equal(badColors.json.error!.code, 'COLORS_INVALID');

    const created = await harness.request<{ id: number }>('POST', '/api/analyses', {
      colors: ['A'],
      slots: 2,
    });
    const id = created.json.data!.id;
    const wrongLength = await harness.request('POST', `/api/analyses/${id}/records`, {
      guess: [0, 0, 0],
      black: 0,
      white: 0,
    });
    assert.equal(wrongLength.json.error!.code, 'SEQUENCE_LENGTH');

    const badFeedback = await harness.request('POST', `/api/analyses/${id}/records`, {
      guess: [0, 0],
      black: 1,
      white: 2,
    });
    assert.equal(badFeedback.json.error!.code, 'FEEDBACK_INVALID');

    const missing = await harness.request('GET', '/api/analyses/999999');
    assert.equal(missing.status, 404);
    assert.equal(missing.json.error!.code, 'NOT_FOUND');
  } finally {
    harness.stop();
  }
});
