import { AppError } from './errors';

export interface RuleInput {
  colors: unknown;
  slots: unknown;
}

export interface Rules {
  colors: string[];
  slots: number;
}

export function validateColors(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    throw new AppError('COLORS_INVALID', 'colors 必须是字符串数组');
  }
  if (raw.length < 1) {
    throw new AppError('COLORS_INVALID', '至少需要 1 种颜色');
  }
  const colors: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (typeof item !== 'string' || item.trim() === '') {
      throw new AppError('COLORS_INVALID', `第 ${i + 1} 个颜色必须是非空字符串`, { index: i });
    }
    if (seen.has(item)) {
      throw new AppError('COLORS_INVALID', `颜色 "${item}" 重复，颜色表必须唯一`, { index: i });
    }
    seen.add(item);
    colors.push(item);
  }
  return colors;
}

export function validateSlots(raw: unknown, maxSlots: number): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) {
    throw new AppError('SLOTS_INVALID', 'slots 必须是整数');
  }
  if (raw < 1) {
    throw new AppError('SLOTS_INVALID', 'slots 至少为 1');
  }
  if (raw > maxSlots) {
    throw new AppError('SLOTS_INVALID', `slots 不能超过上限 ${maxSlots}`, { maxSlots });
  }
  return raw;
}

export function validateRules(input: RuleInput, maxColors: number, maxSlots: number): Rules {
  const colors = validateColors(input.colors);
  if (colors.length > maxColors) {
    throw new AppError('COLORS_INVALID', `颜色数不能超过上限 ${maxColors}`, { maxColors });
  }
  const slots = validateSlots(input.slots, maxSlots);
  return { colors, slots };
}

export function totalCandidateCount(colorCount: number, slots: number): number {
  return Math.pow(colorCount, slots);
}
