import { AppError } from './errors';
import { totalCandidateCount } from './rules';

/**
 * 建立允许范围内的完整有序候选集合（可重复颜色）。
 * 按混合基数计数枚举：索引 0 是最高位，序列按注册颜色序做字典序。
 */
export function enumerateCandidates(
  colorCount: number,
  slots: number,
  maxCandidates: number,
): Int32Array[] {
  const total = totalCandidateCount(colorCount, slots);
  if (total > maxCandidates) {
    throw new AppError(
      'TOO_MANY_CANDIDATES',
      `完整候选总量 ${total} 超过上限 ${maxCandidates}，请缩小颜色数或槽位数`,
      { total, maxCandidates },
    );
  }
  const result: Int32Array[] = new Array(total);
  for (let n = 0; n < total; n++) {
    const seq = new Int32Array(slots);
    let value = n;
    for (let pos = slots - 1; pos >= 0; pos--) {
      seq[pos] = value % colorCount;
      value = Math.floor(value / colorCount);
    }
    result[n] = seq;
  }
  return result;
}

export function compareSequences(a: Int32Array, b: Int32Array): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

export function encodeSequence(seq: Int32Array | number[], colorCount: number): number {
  let code = 0;
  for (let i = 0; i < seq.length; i++) {
    code = code * colorCount + seq[i];
  }
  return code;
}

export function decodeSequence(code: number, colorCount: number, slots: number): Int32Array {
  const seq = new Int32Array(slots);
  let value = code;
  for (let pos = slots - 1; pos >= 0; pos--) {
    seq[pos] = value % colorCount;
    value = Math.floor(value / colorCount);
  }
  return seq;
}

export function encodeCodeString(seq: Int32Array | number[], colorCount: number): string {
  return String(encodeSequence(seq, colorCount));
}
