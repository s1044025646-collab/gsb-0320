import { computeFeedback, feedbackKey } from './feedback';

export interface SuggestionBudget {
  maxGuesses: number;
  maxFeedbackComparisons: number;
}

export interface Suggestion {
  guess: number[];
  bucketCount: number;
  worstRemaining: number;
  comparisonsUsed: number;
}

export interface SuggestionResult {
  status: 'unique' | 'computed' | 'empty' | 'budget_exceeded';
  suggestion: Suggestion | null;
  candidatesConsidered: number;
  comparisonsUsed: number;
  budget: SuggestionBudget;
  message: string;
}

interface Bucket {
  key: string;
  size: number;
}

/**
 * 单步最坏情况（minimax）建议：
 * 对每个候选猜测，把当前所有可能答案按反馈分桶，记录最大桶大小（最坏剩余候选数）。
 * 选择最大桶最小的猜测；平局时候选已按注册颜色序排列，取最先遇到者。
 *
 * 预算为公开的猜测数与反馈比较次数；一旦无法在预算内评估完全部猜测，
 * 返回 budget_exceeded，绝不用部分猜测冒充全局最优。
 */
export function suggestNext(
  candidates: Int32Array[],
  colorCount: number,
  budget: SuggestionBudget,
): SuggestionResult {
  if (candidates.length === 0) {
    return {
      status: 'empty',
      suggestion: null,
      candidatesConsidered: 0,
      comparisonsUsed: 0,
      budget,
      message: '当前候选为空，规则或历史可能存在矛盾',
    };
  }
  if (candidates.length === 1) {
    const only = Array.from(candidates[0]);
    return {
      status: 'unique',
      suggestion: { guess: only, bucketCount: 1, worstRemaining: 1, comparisonsUsed: 0 },
      candidatesConsidered: 1,
      comparisonsUsed: 0,
      budget,
      message: '只剩一个候选，即为答案',
    };
  }
  if (candidates.length > budget.maxGuesses) {
    return {
      status: 'budget_exceeded',
      suggestion: null,
      candidatesConsidered: 0,
      comparisonsUsed: 0,
      budget,
      message: `需要评估 ${candidates.length} 个猜测，超过猜测预算 ${budget.maxGuesses}`,
    };
  }

  let comparisons = 0;
  let best: Suggestion | null = null;
  const answerCount = candidates.length;

  for (let gi = 0; gi < candidates.length; gi++) {
    const guess = candidates[gi];
    const buckets = new Map<string, number>();
    for (let ai = 0; ai < answerCount; ai++) {
      if (comparisons >= budget.maxFeedbackComparisons) {
        return {
          status: 'budget_exceeded',
          suggestion: null,
          candidatesConsidered: gi,
          comparisonsUsed: comparisons,
          budget,
          message: `反馈比较次数达到预算 ${budget.maxFeedbackComparisons}，未完成全局评估`,
        };
      }
      const f = computeFeedback(guess, candidates[ai], colorCount);
      comparisons++;
      const key = feedbackKey(f);
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    let worst = 0;
    for (const size of buckets.values()) {
      if (size > worst) worst = size;
    }
    // 候选已按注册颜色序字典序排列；只在严格更小时更新，平局自然取最靠前的猜测。
    if (best === null || worst < best.worstRemaining) {
      best = {
        guess: Array.from(guess),
        bucketCount: buckets.size,
        worstRemaining: worst,
        comparisonsUsed: comparisons,
      };
    }
  }

  return {
    status: 'computed',
    suggestion: best,
    candidatesConsidered: candidates.length,
    comparisonsUsed: comparisons,
    budget,
    message: '已对全部候选猜测完成分桶评估（全局单步最坏情况最优）',
  };
}

export function describeBuckets(
  candidates: Int32Array[],
  guess: number[],
  colorCount: number,
): Bucket[] {
  const buckets = new Map<string, number>();
  for (const answer of candidates) {
    const key = feedbackKey(computeFeedback(guess, answer, colorCount));
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return Array.from(buckets.entries())
    .map(([key, size]) => {
      const [black, white] = key.split(':').map(Number);
      return { key: `黑${black}白${white}`, size };
    })
    .sort((a, b) => (a.size === b.size ? (a.key < b.key ? -1 : 1) : b.size - a.size));
}
