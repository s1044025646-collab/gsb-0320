import { Feedback, computeFeedback } from './feedback';

/** 保留对给定猜测恰好产生指定反馈的候选。返回新数组，不修改输入。 */
export function filterCandidates(
  candidates: Int32Array[],
  guess: number[],
  expected: Feedback,
  colorCount: number,
): Int32Array[] {
  const kept: Int32Array[] = [];
  for (const candidate of candidates) {
    const f = computeFeedback(guess, candidate, colorCount);
    if (f.black === expected.black && f.white === expected.white) {
      kept.push(candidate);
    }
  }
  return kept;
}
