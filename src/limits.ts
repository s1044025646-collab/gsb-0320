export interface Limits {
  maxColors: number;
  maxSlots: number;
  maxCandidates: number;
  maxPageSize: number;
  defaultPageSize: number;
  defaultGuessBudget: number;
  defaultFeedbackBudget: number;
}

export const DEFAULT_LIMITS: Limits = {
  maxColors: 10,
  maxSlots: 6,
  maxCandidates: 100_000,
  maxPageSize: 500,
  defaultPageSize: 100,
  defaultGuessBudget: 100_000,
  defaultFeedbackBudget: 5_000_000,
};

export function loadLimits(env: NodeJS.ProcessEnv = process.env): Limits {
  const num = (key: string, fallback: number): number => {
    const raw = env[key];
    if (raw === undefined || raw === '') return fallback;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
  };
  return {
    maxColors: num('MM_MAX_COLORS', DEFAULT_LIMITS.maxColors),
    maxSlots: num('MM_MAX_SLOTS', DEFAULT_LIMITS.maxSlots),
    maxCandidates: num('MM_MAX_CANDIDATES', DEFAULT_LIMITS.maxCandidates),
    maxPageSize: num('MM_MAX_PAGE_SIZE', DEFAULT_LIMITS.maxPageSize),
    defaultPageSize: num('MM_DEFAULT_PAGE_SIZE', DEFAULT_LIMITS.defaultPageSize),
    defaultGuessBudget: num('MM_GUESS_BUDGET', DEFAULT_LIMITS.defaultGuessBudget),
    defaultFeedbackBudget: num('MM_FEEDBACK_BUDGET', DEFAULT_LIMITS.defaultFeedbackBudget),
  };
}
