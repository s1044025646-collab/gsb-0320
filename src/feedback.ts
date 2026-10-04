import { AppError } from './errors';

export interface Feedback {
  black: number;
  white: number;
}

export function validateSequence(seq: unknown, colorCount: number, slots: number): number[] {
  if (!Array.isArray(seq)) {
    throw new AppError('SEQUENCE_NOT_ARRAY', '序列必须是整数数组（颜色索引从 0 开始）');
  }
  if (seq.length !== slots) {
    throw new AppError('SEQUENCE_LENGTH', `序列长度必须等于槽位数 ${slots}`, {
      expected: slots,
      actual: seq.length,
    });
  }
  const out: number[] = new Array(slots);
  for (let i = 0; i < slots; i++) {
    const value = seq[i];
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      throw new AppError('COLOR_INDEX_OUT_OF_RANGE', `第 ${i + 1} 个位置必须是颜色索引整数`, {
        position: i,
      });
    }
    if (value < 0 || value >= colorCount) {
      throw new AppError('COLOR_INDEX_OUT_OF_RANGE', `第 ${i + 1} 个位置的颜色索引 ${value} 超出范围`, {
        position: i,
        value,
        colorCount,
      });
    }
    out[i] = value;
  }
  return out;
}

export function validateFeedback(raw: unknown, slots: number): Feedback {
  if (typeof raw !== 'object' || raw === null) {
    throw new AppError('FEEDBACK_INVALID', '反馈必须是包含 black 与 white 的对象');
  }
  const obj = raw as Record<string, unknown>;
  const black = obj.black;
  const white = obj.white;
  if (typeof black !== 'number' || !Number.isInteger(black) || black < 0) {
    throw new AppError('FEEDBACK_INVALID', 'black 必须是非负整数');
  }
  if (typeof white !== 'number' || !Number.isInteger(white) || white < 0) {
    throw new AppError('FEEDBACK_INVALID', 'white 必须是非负整数');
  }
  if (black + white > slots) {
    throw new AppError('FEEDBACK_INVALID', `black + white 不能超过槽位数 ${slots}`, {
      black,
      white,
      slots,
    });
  }
  return { black, white };
}

/**
 * 重复颜色反馈：
 * 1. 先统计位置与颜色都正确的黑色数；
 * 2. 对每种颜色取猜测与答案中出现次数的较小值求和，得到总命中数；
 * 3. 白色 = 总命中 - 黑色。
 */
export type Seq = readonly number[] | Int32Array;

export function computeFeedback(guess: Seq, answer: Seq, colorCount: number): Feedback {
  let black = 0;
  for (let i = 0; i < guess.length; i++) {
    if (guess[i] === answer[i]) black++;
  }
  const guessCounts = new Int32Array(colorCount);
  const answerCounts = new Int32Array(colorCount);
  for (let i = 0; i < guess.length; i++) {
    guessCounts[guess[i]]++;
    answerCounts[answer[i]]++;
  }
  let totalHits = 0;
  for (let c = 0; c < colorCount; c++) {
    totalHits += guessCounts[c] < answerCounts[c] ? guessCounts[c] : answerCounts[c];
  }
  return { black, white: totalHits - black };
}

export function feedbackKey(f: Feedback): string {
  return `${f.black}:${f.white}`;
}

export function sameFeedback(a: Feedback, b: Feedback): boolean {
  return a.black === b.black && a.white === b.white;
}

export function feedbackToString(seq: number[], colors: string[], f: Feedback): string {
  const labels = seq.map((index) => colors[index]).join(',');
  return `[${labels}] => 黑${f.black} 白${f.white}`;
}
