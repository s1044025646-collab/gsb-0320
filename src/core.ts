// 核心领域逻辑：反馈计算、候选枚举、筛选、建议。无 IO 依赖。
export interface Rules {
  colorCount: number;
  slots: number;
}

export interface Feedback {
  black: number;
  white: number;
}

export const MAX_COLORS = 10;
export const MAX_SLOTS = 8;
export const MAX_CANDIDATES = 200000;
export const DEFAULT_SUGGEST_BUDGET = 2_000_000;
export const MAX_PAGE_LIMIT = 500;

export class ApiError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

export function validateRules(rules: Rules): void {
  if (!Number.isInteger(rules.colorCount) || rules.colorCount < 2 || rules.colorCount > MAX_COLORS) {
    throw new ApiError("INVALID_RULES", `colorCount 必须是 2..${MAX_COLORS} 的整数`);
  }
  if (!Number.isInteger(rules.slots) || rules.slots < 1 || rules.slots > MAX_SLOTS) {
    throw new ApiError("INVALID_RULES", `slots 必须是 1..${MAX_SLOTS} 的整数`);
  }
  const total = Math.pow(rules.colorCount, rules.slots);
  if (total > MAX_CANDIDATES) {
    throw new ApiError("RULES_TOO_LARGE", `完整候选总量 ${total} 超过上限 ${MAX_CANDIDATES}`);
  }
}

export function validateSequence(seq: unknown, rules: Rules, label = "sequence"): asserts seq is number[] {
  if (!Array.isArray(seq) || seq.length !== rules.slots) {
    throw new ApiError("INVALID_SEQUENCE", `${label} 必须是长度为 ${rules.slots} 的数组`);
  }
  for (const c of seq) {
    if (!Number.isInteger(c) || (c as number) < 1 || (c as number) > rules.colorCount) {
      throw new ApiError("INVALID_SEQUENCE", `${label} 中的颜色必须是 1..${rules.colorCount} 的整数`);
    }
  }
}

export function validateFeedback(fb: unknown, rules: Rules): asserts fb is Feedback {
  const f = fb as Feedback;
  if (!f || !Number.isInteger(f.black) || !Number.isInteger(f.white)) {
    throw new ApiError("INVALID_FEEDBACK", "feedback 必须包含非负整数 black 与 white");
  }
  if (f.black < 0 || f.white < 0) {
    throw new ApiError("INVALID_FEEDBACK", "black 与 white 必须为非负整数");
  }
  if (f.black + f.white > rules.slots) {
    throw new ApiError("INVALID_FEEDBACK", `black + white 不能超过槽位数 ${rules.slots}`);
  }
}

/** 重复颜色反馈：先算黑色，再按颜色取两边次数较小值求总命中，白色 = 总命中 - 黑色。 */
export function computeFeedback(secret: number[], guess: number[]): Feedback {
  let black = 0;
  const secretCounts = new Map<number, number>();
  const guessCounts = new Map<number, number>();
  for (let i = 0; i < secret.length; i++) {
    if (secret[i] === guess[i]) black++;
    secretCounts.set(secret[i], (secretCounts.get(secret[i]) ?? 0) + 1);
    guessCounts.set(guess[i], (guessCounts.get(guess[i]) ?? 0) + 1);
  }
  let total = 0;
  for (const [color, gc] of guessCounts) {
    total += Math.min(gc, secretCounts.get(color) ?? 0);
  }
  return { black, white: total - black };
}

/** 生成完整有序候选集合（按注册颜色序的字典序）。 */
export function enumerateCandidates(rules: Rules): number[][] {
  validateRules(rules);
  const out: number[][] = [];
  const cur = new Array<number>(rules.slots);
  const rec = (pos: number): void => {
    if (pos === rules.slots) {
      out.push([...cur]);
      return;
    }
    for (let c = 1; c <= rules.colorCount; c++) {
      cur[pos] = c;
      rec(pos + 1);
    }
  };
  rec(0);
  return out;
}

export function matchesFeedback(secret: number[], guess: number[], fb: Feedback): boolean {
  const got = computeFeedback(secret, guess);
  return got.black === fb.black && got.white === fb.white;
}

export interface FilterResult {
  before: number;
  after: number;
  candidates: number[][];
}

export function filterCandidates(candidates: number[][], guess: number[], fb: Feedback): FilterResult {
  const kept = candidates.filter((c) => matchesFeedback(c, guess, fb));
  return { before: candidates.length, after: kept.length, candidates: kept };
}

export interface SuggestResult {
  computed: boolean;
  reason?: string;
  guess?: number[];
  bucketCount?: number;
  worstBucket?: number;
  comparisons?: number;
}

/** 下一步建议：仅从当前候选中选，按反馈分桶最小化最大桶，平局取枚举序最靠前。 */
export function suggestNext(candidates: number[][], budget = DEFAULT_SUGGEST_BUDGET): SuggestResult {
  if (candidates.length === 0) {
    throw new ApiError("NO_CANDIDATES", "候选集为空，无法给出建议", 409);
  }
  if (candidates.length === 1) {
    return { computed: true, guess: [...candidates[0]], bucketCount: 1, worstBucket: 1, comparisons: 0 };
  }
  const total = candidates.length * candidates.length;
  if (total > budget) {
    return {
      computed: false,
      reason: `评估全部猜测需要 ${total} 次反馈比较，超过预算 ${budget}，未计算建议`,
    };
  }
  let best: number[] | null = null;
  let bestWorst = Infinity;
  let bestBuckets = 0;
  let comparisons = 0;
  for (const guess of candidates) {
    const buckets = new Map<string, number>();
    for (const secret of candidates) {
      const f = computeFeedback(secret, guess);
      const key = `${f.black},${f.white}`;
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
      comparisons++;
    }
    let worst = 0;
    for (const v of buckets.values()) worst = Math.max(worst, v);
    if (worst < bestWorst) {
      bestWorst = worst;
      best = guess;
      bestBuckets = buckets.size;
    }
  }
  return {
    computed: true,
    guess: [...(best as number[])],
    bucketCount: bestBuckets,
    worstBucket: bestWorst,
    comparisons,
  };
}

/** 候选摘要（持久化用，重启后校验一致性）。 */
export function candidateDigest(candidates: number[][]): string {
  let h = 2166136261 >>> 0;
  const mix = (n: number): void => {
    h ^= n & 0xff;
    h = Math.imul(h, 16777619) >>> 0;
  };
  mix(candidates.length);
  for (const c of candidates) for (const v of c) mix(v);
  return h.toString(16).padStart(8, "0");
}
