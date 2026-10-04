import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeFeedback,
  enumerateCandidates,
  filterCandidates,
  suggestNext,
  Feedback,
} from "../src/core";

/** 独立核对实现：一对一配对枚举（回溯求最大匹配数）。 */
function pairingFeedback(secret: number[], guess: number[]): Feedback {
  let black = 0;
  const sRem: number[] = [];
  const gRem: number[] = [];
  for (let i = 0; i < secret.length; i++) {
    if (secret[i] === guess[i]) black++;
    else {
      sRem.push(secret[i]);
      gRem.push(guess[i]);
    }
  }
  let best = 0;
  const used = new Array<boolean>(sRem.length).fill(false);
  const rec = (gi: number, matched: number): void => {
    if (gi === gRem.length) {
      best = Math.max(best, matched);
      return;
    }
    rec(gi + 1, matched);
    for (let si = 0; si < sRem.length; si++) {
      if (!used[si] && sRem[si] === gRem[gi]) {
        used[si] = true;
        rec(gi + 1, matched + 1);
        used[si] = false;
      }
    }
  };
  rec(0, 0);
  return { black, white: best };
}

test("演示用例：1122 vs 1212 = 2黑2白", () => {
  assert.deepEqual(computeFeedback([1, 1, 2, 2], [1, 2, 1, 2]), { black: 2, white: 2 });
});

test("全对 / 全错 / 全部同色 / 只有白色", () => {
  assert.deepEqual(computeFeedback([1, 2, 3, 4], [1, 2, 3, 4]), { black: 4, white: 0 });
  assert.deepEqual(computeFeedback([1, 1, 1, 1], [2, 2, 2, 2]), { black: 0, white: 0 });
  assert.deepEqual(computeFeedback([3, 3, 3, 3], [3, 3, 3, 3]), { black: 4, white: 0 });
  assert.deepEqual(computeFeedback([1, 2, 3, 4], [4, 3, 2, 1]), { black: 0, white: 4 });
});

test("重复颜色不过量计白", () => {
  assert.deepEqual(computeFeedback([1, 1, 2, 2], [1, 1, 1, 1]), { black: 2, white: 0 });
  assert.deepEqual(computeFeedback([1, 2, 3, 4], [1, 1, 1, 1]), { black: 1, white: 0 });
  assert.deepEqual(computeFeedback([1, 1, 1, 2], [1, 2, 2, 2]), { black: 2, white: 0 });
});

test("小规则上与一对一配对枚举交叉核对全部序列对", () => {
  const rules = { colorCount: 3, slots: 4 };
  const all = enumerateCandidates(rules);
  for (const secret of all) {
    for (const guess of all) {
      assert.deepEqual(computeFeedback(secret, guess), pairingFeedback(secret, guess));
    }
  }
});

test("颜色一致重命名保持反馈与候选数量不变", () => {
  const rules = { colorCount: 3, slots: 3 };
  const all = enumerateCandidates(rules);
  const rename = (seq: number[]): number[] => seq.map((c) => ((c + 1) % 3) + 1);
  for (const secret of all.slice(0, 27)) {
    for (const guess of all.slice(0, 27)) {
      assert.deepEqual(computeFeedback(rename(secret), rename(guess)), computeFeedback(secret, guess));
    }
  }
  const history: { guess: number[]; fb: Feedback }[] = [
    { guess: [1, 1, 2], fb: computeFeedback([1, 2, 3], [1, 1, 2]) },
  ];
  const kept = filterCandidates(all, history[0].guess, history[0].fb).candidates;
  const keptRenamed = filterCandidates(
    all.map(rename),
    rename(history[0].guess),
    history[0].fb
  ).candidates;
  assert.equal(kept.length, keptRenamed.length);
});

test("建议分桶与穷举核对一致，且平局取枚举序最靠前", () => {
  const rules = { colorCount: 2, slots: 3 };
  const all = enumerateCandidates(rules);
  const s = suggestNext(all);
  assert.equal(s.computed, true);
  assert.deepEqual(s.guess, [1, 1, 1]);
  assert.equal(s.comparisons, 64);
  // 手工核对 [1,1,1] 的最坏桶
  const buckets = new Map<string, number>();
  for (const secret of all) {
    const f = computeFeedback(secret, [1, 1, 1]);
    const k = `${f.black},${f.white}`;
    buckets.set(k, (buckets.get(k) ?? 0) + 1);
  }
  assert.equal(s.bucketCount, buckets.size);
  assert.equal(s.worstBucket, Math.max(...buckets.values()));
});

test("单候选直接返回；预算超限返回未计算", () => {
  const one = suggestNext([[1, 2, 3]]);
  assert.deepEqual(one.guess, [1, 2, 3]);
  const rules = { colorCount: 4, slots: 3 };
  const all = enumerateCandidates(rules);
  const limited = suggestNext(all, 10);
  assert.equal(limited.computed, false);
  assert.ok(limited.reason);
});
