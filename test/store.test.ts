import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ApiError, enumerateCandidates, filterCandidates } from "../src/core";
import { Store } from "../src/store";

const RULES = { colorCount: 4, slots: 4 };

test("追加过滤与穷举核对一致", () => {
  const store = new Store(":memory:");
  const a = store.createAnalysis(RULES);
  const r = store.appendRecord(a.id, [1, 1, 2, 2], { black: 1, white: 1 });
  const expected = filterCandidates(enumerateCandidates(RULES), [1, 1, 2, 2], {
    black: 1,
    white: 1,
  }).candidates;
  assert.equal(r.after, expected.length);
  assert.deepEqual(store.loadCandidates(a.id), expected);
});

test("矛盾反馈被拒绝且旧状态不变", () => {
  const store = new Store(":memory:");
  const a = store.createAnalysis(RULES);
  store.appendRecord(a.id, [1, 1, 1, 1], { black: 0, white: 0 });
  const before = store.getAnalysis(a.id);
  const beforeRecords = store.listRecords(a.id);
  assert.throws(
    () => store.appendRecord(a.id, [1, 1, 1, 1], { black: 4, white: 0 }),
    (e: ApiError) => e.code === "INCONSISTENT"
  );
  const after = store.getAnalysis(a.id);
  assert.deepEqual(after, before);
  assert.deepEqual(store.listRecords(a.id), beforeRecords);
});

test("撤销再追加与一次性分析一致", () => {
  const store = new Store(":memory:");
  const a = store.createAnalysis(RULES);
  store.appendRecord(a.id, [1, 1, 2, 2], { black: 1, white: 1 });
  store.appendRecord(a.id, [3, 3, 4, 4], { black: 0, white: 2 });
  const undo = store.undoLast(a.id);
  assert.deepEqual(undo.removed.guess, [3, 3, 4, 4]);
  const expected = filterCandidates(enumerateCandidates(RULES), [1, 1, 2, 2], {
    black: 1,
    white: 1,
  }).candidates;
  assert.deepEqual(store.loadCandidates(a.id), expected);
  store.appendRecord(a.id, [3, 3, 4, 4], { black: 0, white: 2 });
  const store2 = new Store(":memory:");
  const b = store2.createAnalysis(RULES);
  store2.appendRecord(b.id, [1, 1, 2, 2], { black: 1, white: 1 });
  store2.appendRecord(b.id, [3, 3, 4, 4], { black: 0, white: 2 });
  assert.deepEqual(store.loadCandidates(a.id), store2.loadCandidates(b.id));
});

test("恰好单候选", () => {
  const store = new Store(":memory:");
  const rules = { colorCount: 2, slots: 2 };
  const a = store.createAnalysis(rules);
  store.appendRecord(a.id, [1, 2], { black: 0, white: 2 });
  const cands = store.loadCandidates(a.id);
  assert.deepEqual(cands, [[2, 1]]);
});

test("参数校验：槽位数、颜色范围、反馈范围", () => {
  const store = new Store(":memory:");
  const a = store.createAnalysis(RULES);
  assert.throws(() => store.appendRecord(a.id, [1, 2, 3], { black: 0, white: 0 }), /长度/);
  assert.throws(() => store.appendRecord(a.id, [1, 2, 3, 9], { black: 0, white: 0 }), /颜色/);
  assert.throws(() => store.appendRecord(a.id, [1, 2, 3, 4], { black: 3, white: 2 }), /不能超过/);
  assert.throws(() => store.appendRecord(a.id, [1, 2, 3, 4], { black: -1, white: 0 }), /非负/);
  assert.throws(() => store.createAnalysis({ colorCount: 10, slots: 8 }), /超过上限/);
});

test("重启后继续追加与一次性分析一致", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-"));
  const db = path.join(dir, "t.db");
  let store = new Store(db);
  const a = store.createAnalysis(RULES);
  store.appendRecord(a.id, [1, 1, 2, 2], { black: 1, white: 1 });
  store.close();
  store = new Store(db);
  store.appendRecord(a.id, [3, 3, 4, 4], { black: 0, white: 2 });
  const resumed = store.loadCandidates(a.id);
  store.close();
  const store2 = new Store(":memory:");
  const b = store2.createAnalysis(RULES);
  store2.appendRecord(b.id, [1, 1, 2, 2], { black: 1, white: 1 });
  store2.appendRecord(b.id, [3, 3, 4, 4], { black: 0, white: 2 });
  assert.deepEqual(resumed, store2.loadCandidates(b.id));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("撤销空历史报错；规则修改必须新建分析", () => {
  const store = new Store(":memory:");
  const a = store.createAnalysis(RULES);
  assert.throws(() => store.undoLast(a.id), (e: ApiError) => e.code === "NOTHING_TO_UNDO");
  const b = store.createAnalysis({ colorCount: 3, slots: 3 });
  assert.notEqual(a.id, b.id);
});
