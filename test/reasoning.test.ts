import test from 'node:test';
import assert from 'node:assert/strict';
import { enumerateCandidates, compareSequences } from '../src/enumerate';
import { filterCandidates } from '../src/filter';
import { computeFeedback } from '../src/feedback';
import { describeBuckets, suggestNext } from '../src/suggest';

test('候选集合完整、按注册颜色序字典序排列', () => {
  const candidates = enumerateCandidates(2, 3, 1_000_000);
  assert.equal(candidates.length, 8);
  for (let i = 1; i < candidates.length; i++) {
    assert.ok(compareSequences(candidates[i - 1], candidates[i]) < 0);
  }
  assert.deepEqual(Array.from(candidates[0]), [0, 0, 0]);
  assert.deepEqual(Array.from(candidates[candidates.length - 1]), [1, 1, 1]);
});

test('两条反馈联合排除：1212=>2,2 后 1122=>4,0 唯一确定', () => {
  const candidates = enumerateCandidates(4, 4, 1_000_000);
  const afterFirst = filterCandidates(candidates, [1, 2, 1, 2], { black: 2, white: 2 }, 4);
  assert.ok(afterFirst.length > 1);
  const expectedAfterFirst = candidates.filter((c) => {
    const f = computeFeedback([1, 2, 1, 2], c, 4);
    return f.black === 2 && f.white === 2;
  });
  assert.equal(afterFirst.length, expectedAfterFirst.length);
  const afterSecond = filterCandidates(afterFirst, [1, 1, 2, 2], { black: 4, white: 0 }, 4);
  assert.equal(afterSecond.length, 1);
  assert.deepEqual(Array.from(afterSecond[0]), [1, 1, 2, 2]);
});

test('穷举历史：每条有效记录筛选结果等于逐条全量重算', () => {
  const colorCount = 3;
  const slots = 3;
  const all = enumerateCandidates(colorCount, slots, 1_000_000);
  const history: Array<{ guess: number[]; black: number; white: number }> = [
    { guess: [0, 1, 2], black: 1, white: 1 },
    { guess: [1, 1, 1], black: 0, white: 0 },
    { guess: [0, 0, 2], black: 2, white: 0 },
  ];
  let incremental = all;
  for (const record of history) {
    incremental = filterCandidates(incremental, record.guess, record, colorCount);
    let fromScratch = all;
    for (const applied of history.slice(0, history.indexOf(record) + 1)) {
      fromScratch = filterCandidates(fromScratch, applied.guess, applied, colorCount);
    }
    assert.equal(incremental.length, fromScratch.length);
    for (let i = 0; i < incremental.length; i++) {
      assert.equal(compareSequences(incremental[i], fromScratch[i]), 0);
    }
  }
  assert.ok(incremental.length >= 1);
});

test('建议分桶：桶大小之和等于候选数，最坏桶为最大桶', () => {
  const candidates = enumerateCandidates(2, 2, 1_000_000);
  const result = suggestNext(candidates, 2, {
    maxGuesses: 100,
    maxFeedbackComparisons: 100_000,
  });
  assert.equal(result.status, 'computed');
  assert.ok(result.suggestion);
  const buckets = describeBuckets(candidates, result.suggestion!.guess, 2);
  assert.equal(
    buckets.reduce((sum, bucket) => sum + bucket.size, 0),
    candidates.length,
  );
  assert.equal(
    result.suggestion!.worstRemaining,
    Math.max(...buckets.map((bucket) => bucket.size)),
  );
});

test('建议为全局单步最优：与独立枚举每个猜测的结果一致', () => {
  const colorCount = 2;
  const slots = 3;
  const candidates = enumerateCandidates(colorCount, slots, 1_000_000);
  const result = suggestNext(candidates, colorCount, {
    maxGuesses: 100,
    maxFeedbackComparisons: 100_000,
  });
  let globalBestWorst = Infinity;
  for (const guess of candidates) {
    const buckets = describeBuckets(candidates, Array.from(guess), colorCount);
    const worst = Math.max(...buckets.map((bucket) => bucket.size));
    if (worst < globalBestWorst) globalBestWorst = worst;
  }
  assert.equal(result.suggestion!.worstRemaining, globalBestWorst);
});

test('平局取注册颜色序最靠前的猜测', () => {
  const candidates = enumerateCandidates(2, 2, 1_000_000);
  const result = suggestNext(candidates, 2, {
    maxGuesses: 100,
    maxFeedbackComparisons: 100_000,
  });
  assert.deepEqual(result.suggestion!.guess, [0, 0]);
});

test('只有一个候选时直接给出它且不消耗比较', () => {
  const result = suggestNext([new Int32Array([0, 1])], 2, {
    maxGuesses: 1,
    maxFeedbackComparisons: 1,
  });
  assert.equal(result.status, 'unique');
  assert.deepEqual(result.suggestion!.guess, [0, 1]);
});

test('空候选返回 empty', () => {
  const result = suggestNext([], 2, { maxGuesses: 1, maxFeedbackComparisons: 1 });
  assert.equal(result.status, 'empty');
});

test('预算超限时不宣称最优', () => {
  const candidates = enumerateCandidates(3, 4, 1_000_000);
  assert.equal(candidates.length, 81);
  const byGuesses = suggestNext(candidates, 3, { maxGuesses: 10, maxFeedbackComparisons: 1_000_000 });
  assert.equal(byGuesses.status, 'budget_exceeded');
  assert.equal(byGuesses.suggestion, null);
  const byComparisons = suggestNext(candidates, 3, {
    maxGuesses: 100,
    maxFeedbackComparisons: 50,
  });
  assert.equal(byComparisons.status, 'budget_exceeded');
  assert.equal(byComparisons.suggestion, null);
});
