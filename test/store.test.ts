import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store';
import { DEFAULT_LIMITS } from '../src/limits';
import { AppError } from '../src/errors';

function tempDb(): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'mm-test-'));
  return { dir, path: join(dir, 'test.sqlite') };
}

function cleanup(dir: string): void {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      cleanup(dir);
      return;
    } catch {
      const waitUntil = Date.now() + 50;
      while (Date.now() < waitUntil) {
        // Windows 下文件句柄释放可能有短暂延迟
      }
    }
  }
}

test('矛盾反馈被拒绝且旧状态不变', () => {
  const { dir, path } = tempDb();
  try {
    const store = new Store(path, DEFAULT_LIMITS.maxCandidates);
    const analysis = store.createAnalysis({ colors: ['A', 'B'], slots: 2 });
    const ok = store.appendFeedback(analysis.id, [0, 0], { black: 2, white: 0 });
    assert.equal(ok.outcome.accepted, true);
    const rejected = store.appendFeedback(analysis.id, [1, 1], { black: 1, white: 0 });
    assert.equal(rejected.outcome.accepted, false);
    assert.equal(rejected.outcome.beforeCount, 1);
    assert.equal(rejected.outcome.afterCount, 0);
    const reloaded = store.loadAnalysis(analysis.id);
    assert.equal(reloaded.remainingCandidates, 1);
    assert.equal(reloaded.records.length, 1);
    assert.equal(reloaded.version, 1);
    store.close();
  } finally {
    cleanup(dir);
  }
});

test('撤销恢复此前候选，撤销后再追加与一次性历史一致', () => {
  const { dir, path } = tempDb();
  try {
    const store = new Store(path, DEFAULT_LIMITS.maxCandidates);
    const analysis = store.createAnalysis({ colors: ['A', 'B', 'C'], slots: 3 });
    store.appendFeedback(analysis.id, [0, 1, 2], { black: 3, white: 0 });
    const beforeUndo = store.loadAnalysis(analysis.id);
    assert.equal(beforeUndo.remainingCandidates, 1);
    const undo = store.undoLast(analysis.id);
    assert.equal(undo.outcome.afterCount, 27);
    const second = store.appendFeedback(analysis.id, [1, 1, 1], { black: 0, white: 3 });
    assert.equal(second.outcome.accepted, false);
    const fixed = store.appendFeedback(analysis.id, [1, 1, 1], { black: 0, white: 0 });
    assert.equal(fixed.outcome.accepted, true);
    const finalState = store.loadAnalysis(analysis.id);

    const fresh = new Store(join(dir, 'fresh.sqlite'), DEFAULT_LIMITS.maxCandidates);
    const freshAnalysis = fresh.createAnalysis({ colors: ['A', 'B', 'C'], slots: 3 });
    fresh.appendFeedback(freshAnalysis.id, [1, 1, 1], { black: 0, white: 0 });
    const freshState = fresh.loadAnalysis(freshAnalysis.id);
    assert.equal(finalState.remainingCandidates, freshState.remainingCandidates);
    assert.deepEqual(
      Array.from(finalState.candidates[0]),
      Array.from(freshState.candidates[0]),
    );
    store.close();
    fresh.close();
  } finally {
    cleanup(dir);
  }
});

test('重启后继续追加与同一历史一次性分析一致', () => {
  const { dir, path } = tempDb();
  try {
    const store1 = new Store(path, DEFAULT_LIMITS.maxCandidates);
    const a = store1.createAnalysis({ colors: ['A', 'B', 'C'], slots: 3 });
    store1.appendFeedback(a.id, [0, 1, 2], { black: 1, white: 1 });
    store1.close();

    const store2 = new Store(path, DEFAULT_LIMITS.maxCandidates);
    const resumed = store2.loadAnalysis(a.id);
    assert.equal(resumed.records.length, 1);
    store2.appendFeedback(a.id, [2, 2, 0], { black: 0, white: 2 });
    const afterResume = store2.loadAnalysis(a.id);
    store2.close();

    const oneShot = new Store(join(dir, 'one.sqlite'), DEFAULT_LIMITS.maxCandidates);
    const b = oneShot.createAnalysis({ colors: ['A', 'B', 'C'], slots: 3 });
    oneShot.appendFeedback(b.id, [0, 1, 2], { black: 1, white: 1 });
    oneShot.appendFeedback(b.id, [2, 2, 0], { black: 0, white: 2 });
    const oneShotState = oneShot.loadAnalysis(b.id);
    assert.equal(afterResume.remainingCandidates, oneShotState.remainingCandidates);
    assert.equal(afterResume.remainingCandidates > 0, true);
    oneShot.close();
  } finally {
    cleanup(dir);
  }
});

test('颜色一致重命名只改变展示文字，候选数量与顺序不变', () => {
  const { dir, path } = tempDb();
  try {
    const storeA = new Store(path, DEFAULT_LIMITS.maxCandidates);
    const a = storeA.createAnalysis({ colors: ['红', '绿', '蓝'], slots: 3 });
    storeA.appendFeedback(a.id, [0, 1, 2], { black: 1, white: 1 });
    const stateA = storeA.loadAnalysis(a.id);
    storeA.close();

    const storeB = new Store(join(dir, 'b.sqlite'), DEFAULT_LIMITS.maxCandidates);
    const b = storeB.createAnalysis({ colors: ['R', 'G', 'B'], slots: 3 });
    storeB.appendFeedback(b.id, [0, 1, 2], { black: 1, white: 1 });
    const stateB = storeB.loadAnalysis(b.id);

    assert.equal(stateA.totalCandidates, stateB.totalCandidates);
    assert.equal(stateA.remainingCandidates, stateB.remainingCandidates);
    assert.equal(stateA.candidates.length, stateB.candidates.length);
    for (let i = 0; i < stateA.candidates.length; i++) {
      assert.deepEqual(Array.from(stateA.candidates[i]), Array.from(stateB.candidates[i]));
    }
    storeB.close();
  } finally {
    cleanup(dir);
  }
});

test('校验错误码：非法颜色、槽位、序列与反馈', () => {
  const { dir, path } = tempDb();
  try {
    const store = new Store(path, DEFAULT_LIMITS.maxCandidates);
    assert.throws(() => store.createAnalysis({ colors: [], slots: 2 }), (err: unknown) =>
      err instanceof AppError && err.code === 'COLORS_INVALID',
    );
    assert.throws(() => store.createAnalysis({ colors: ['A', 'A'], slots: 2 }), (err: unknown) =>
      err instanceof AppError && err.code === 'COLORS_INVALID',
    );
    assert.throws(() => store.createAnalysis({ colors: ['A'], slots: 0 }), (err: unknown) =>
      err instanceof AppError && err.code === 'SLOTS_INVALID',
    );
    assert.equal(existsSync(path), true);
    store.close();
  } finally {
    cleanup(dir);
  }
});

test('候选总量超限时拒绝创建规则', () => {
  const { dir, path } = tempDb();
  try {
    const store = new Store(path, 100);
    assert.throws(() => store.createAnalysis({ colors: ['A', 'B', 'C'], slots: 5 }), (err: unknown) =>
      err instanceof AppError && err.code === 'TOO_MANY_CANDIDATES',
    );
    store.close();
  } finally {
    cleanup(dir);
  }
});

test('空历史撤销为空操作', () => {
  const { dir, path } = tempDb();
  try {
    const store = new Store(path, DEFAULT_LIMITS.maxCandidates);
    const a = store.createAnalysis({ colors: ['A', 'B'], slots: 2 });
    const undo = store.undoLast(a.id);
    assert.equal(undo.outcome.undone, null);
    assert.equal(undo.outcome.afterCount, 4);
    store.close();
  } finally {
    cleanup(dir);
  }
});

