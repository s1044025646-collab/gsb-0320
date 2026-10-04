import { AppError } from './errors';
import { Limits } from './limits';
import { Rules, validateRules } from './rules';
import { Feedback, computeFeedback, validateFeedback, validateSequence } from './feedback';
import { Analysis, AppendOutcome, Store, UndoOutcome } from './store';
import { SuggestionBudget, SuggestionResult, describeBuckets, suggestNext } from './suggest';

export interface PageParams {
  offset: number;
  limit: number;
}

export interface CandidatePage {
  offset: number;
  limit: number;
  total: number;
  returned: number;
  hasMore: boolean;
  items: Array<{ seq: number[]; labels: string[] }>;
}

export interface HistoryExport {
  id: number;
  colors: string[];
  slots: number;
  version: number;
  totalCandidates: number;
  remainingCandidates: number;
  records: Array<{
    seq: number;
    guess: number[];
    guessLabels: string[];
    black: number;
    white: number;
  }>;
}

export class AppService {
  constructor(
    private readonly store: Store,
    readonly limits: Limits,
  ) {}

  createAnalysis(input: { colors: unknown; slots: unknown }): Analysis {
    const rules = validateRules(input, this.limits.maxColors, this.limits.maxSlots);
    return this.store.createAnalysis(rules);
  }

  listAnalyses() {
    return this.store.listAnalysisSummaries();
  }

  getAnalysis(id: number): Analysis {
    return this.store.loadAnalysis(id);
  }

  /** 计算任意一对序列的反馈，不读取也不修改任何分析历史。 */
  feedbackForPair(input: { colors?: unknown; slots?: unknown; guess: unknown; answer: unknown }): {
    rules: Rules;
    guess: number[];
    answer: number[];
    feedback: Feedback;
  } {
    const rules =
      input.colors !== undefined || input.slots !== undefined
        ? validateRules(
            { colors: input.colors, slots: input.slots },
            this.limits.maxColors,
            this.limits.maxSlots,
          )
        : null;
    const colorCount = rules ? rules.colors.length : this.inferColorCount(input.guess, input.answer);
    const slots = rules ? rules.slots : this.inferSlots(input.guess, input.answer);
    const guess = validateSequence(input.guess, colorCount, slots);
    const answer = validateSequence(input.answer, colorCount, slots);
    return {
      rules: rules ?? { colors: Array.from({ length: colorCount }, (_, i) => `颜色${i}`), slots },
      guess,
      answer,
      feedback: computeFeedback(guess, answer, colorCount),
    };
  }

  private inferColorCount(guess: unknown, answer: unknown): number {
    const maxOf = (seq: unknown): number => {
      if (!Array.isArray(seq) || seq.some((v) => typeof v !== 'number' || !Number.isInteger(v) || v < 0)) {
        throw new AppError('COLOR_INDEX_OUT_OF_RANGE', '未提供规则时，guess 与 answer 必须是非负整数数组');
      }
      return (seq as number[]).reduce((m, v) => (v > m ? v : m), -1);
    }
    const maxIndex = Math.max(maxOf(guess), maxOf(answer));
    return maxIndex + 1;
  }

  private inferSlots(guess: unknown, answer: unknown): number {
    if (!Array.isArray(guess) || !Array.isArray(answer) || guess.length !== answer.length) {
      throw new AppError('SEQUENCE_LENGTH', '未提供规则时，guess 与 answer 长度必须相同');
    }
    if (guess.length === 0) {
      throw new AppError('SEQUENCE_LENGTH', '序列长度至少为 1');
    }
    return guess.length;
  }

  appendFeedback(
    id: number,
    body: { guess: unknown; black?: unknown; white?: unknown; feedback?: unknown },
  ): { analysis: Analysis; outcome: AppendOutcome } {
    const analysis = this.store.loadAnalysis(id);
    const guess = validateSequence(body.guess, analysis.colors.length, analysis.slots);
    const rawFeedback =
      body.feedback !== undefined
        ? body.feedback
        : { black: body.black, white: body.white };
    const feedback = validateFeedback(rawFeedback, analysis.slots);
    return this.store.appendFeedback(analysis.id, guess, feedback);
  }

  undo(id: number): { analysis: Analysis; outcome: UndoOutcome } {
    return this.store.undoLast(id);
  }

  pageCandidates(id: number, query: { offset?: unknown; limit?: unknown }): CandidatePage {
    const analysis = this.store.loadAnalysis(id);
    const offset = this.parseOffset(query.offset);
    const limit = this.parseLimit(query.limit);
    const slice = analysis.candidates.slice(offset, offset + limit);
    return {
      offset,
      limit,
      total: analysis.candidates.length,
      returned: slice.length,
      hasMore: offset + slice.length < analysis.candidates.length,
      items: slice.map((seq) => {
        const indices = Array.from(seq);
        return { seq: indices, labels: indices.map((index) => analysis.colors[index]) };
      }),
    };
  }

  private parseOffset(raw: unknown): number {
    if (raw === undefined || raw === '') return 0;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0) {
      throw new AppError('PAGE_INVALID', 'offset 必须是非负整数');
    }
    return value;
  }

  private parseLimit(raw: unknown): number {
    const fallback = this.limits.defaultPageSize;
    if (raw === undefined || raw === '') return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1) {
      throw new AppError('PAGE_INVALID', 'limit 必须是正整数');
    }
    if (value > this.limits.maxPageSize) {
      throw new AppError('PAGE_INVALID', `limit 不能超过 ${this.limits.maxPageSize}`);
    }
    return value;
  }

  suggestion(
    id: number,
    query: { guessBudget?: unknown; feedbackBudget?: unknown },
  ): SuggestionResult & {
    analysisId: number;
    remainingCandidates: number;
    bucketSizes?: Array<{ feedback: string; size: number }>;
  } {
    const analysis = this.store.loadAnalysis(id);
    const budget = this.parseBudget(query);
    const result = suggestNext(analysis.candidates, analysis.colors.length, budget);
    const response: SuggestionResult & {
      analysisId: number;
      remainingCandidates: number;
      bucketSizes?: Array<{ feedback: string; size: number }>;
    } = {
      ...result,
      analysisId: id,
      remainingCandidates: analysis.candidates.length,
    };
    if (result.suggestion) {
      const guess = result.suggestion.guess;
      response.suggestion = {
        ...result.suggestion,
        guess,
      };
      response.bucketSizes = describeBuckets(
        analysis.candidates,
        guess,
        analysis.colors.length,
      ).map((bucket) => ({ feedback: bucket.key, size: bucket.size }));
    }
    return response;
  }

  private parseBudget(query: { guessBudget?: unknown; feedbackBudget?: unknown }): SuggestionBudget {
    const parseOne = (raw: unknown, fallback: number, name: string): number => {
      if (raw === undefined || raw === '') return fallback;
      const value = Number(raw);
      if (!Number.isInteger(value) || value < 1) {
        throw new AppError('BUDGET_INVALID', `${name} 必须是正整数`);
      }
      return value;
    };
    return {
      maxGuesses: parseOne(query.guessBudget, this.limits.defaultGuessBudget, 'guessBudget'),
      maxFeedbackComparisons: parseOne(
        query.feedbackBudget,
        this.limits.defaultFeedbackBudget,
        'feedbackBudget',
      ),
    };
  }

  exportHistory(id: number): HistoryExport {
    const analysis = this.store.loadAnalysis(id);
    return {
      id: analysis.id,
      colors: analysis.colors,
      slots: analysis.slots,
      version: analysis.version,
      totalCandidates: analysis.totalCandidates,
      remainingCandidates: analysis.remainingCandidates,
      records: analysis.records.map((record) => ({
        seq: record.seq,
        guess: record.guess,
        guessLabels: record.guess.map((index) => analysis.colors[index]),
        black: record.black,
        white: record.white,
      })),
    };
  }
}

export function serializeAnalysis(analysis: Analysis) {
  return {
    id: analysis.id,
    colors: analysis.colors,
    slots: analysis.slots,
    version: analysis.version,
    totalCandidates: analysis.totalCandidates,
    remainingCandidates: analysis.remainingCandidates,
    recordCount: analysis.records.length,
  };
}
