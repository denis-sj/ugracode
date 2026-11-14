import type { Metric, PriorityLevel, PriorityVerdict } from '@ugra/contracts';
import { PriorityLevel as PriorityLevelSchema } from '@ugra/contracts';
import type { PriorityMatrix } from '../contracts';

/** Влияние и срочность не названы — считаем по средней клетке, чтобы заявка не осталась без срока. */
const DEFAULT_IMPACT = 'one';
const DEFAULT_URGENCY = 'workaround';

export interface PriorityInput {
  impact: string | null;
  urgency: string | null;
  emergencyLevel: 'none' | 'suspected' | 'confirmed';
  incident: boolean;
  criticality: 'low' | 'medium' | 'high' | 'critical' | null;
  now: Date;
  matrix: PriorityMatrix;
}

function asLevel(value: string): PriorityLevel | null {
  const parsed = PriorityLevelSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function levelOrder(matrix: PriorityMatrix, level: PriorityLevel): number | null {
  return matrix.levels[level]?.order ?? null;
}

/** +1 уровень критичности: меньше `order` — выше приоритет. */
function raise(matrix: PriorityMatrix, level: PriorityLevel): PriorityLevel | null {
  const order = levelOrder(matrix, level);
  if (order === null) return null;
  const next = Object.entries(matrix.levels).find(([, def]) => def.order === order - 1);
  return next ? asLevel(next[0]) : null;
}

function baseLevel(matrix: PriorityMatrix, impact: string, urgency: string): PriorityLevel | null {
  const raw = matrix.matrix[impact]?.[urgency];
  return raw ? asLevel(raw) : null;
}

function dueAt(now: Date, minutes: number): string {
  return new Date(now.getTime() + minutes * 60_000).toISOString();
}

interface LevelChoice {
  impact: string;
  urgency: string;
  level: PriorityLevel;
  rule: string;
  reason: string;
}

function chooseBase(input: PriorityInput): LevelChoice {
  const impact = input.impact && input.matrix.matrix[input.impact] ? input.impact : null;
  const urgency =
    impact && input.urgency && input.matrix.matrix[impact]?.[input.urgency] ? input.urgency : null;
  const level = impact && urgency ? baseLevel(input.matrix, impact, urgency) : null;
  if (impact && urgency && level) {
    return {
      impact,
      urgency,
      level,
      rule: `${impact} × ${urgency} → ${level} по матрице`,
      reason: `матрица: ${impact} × ${urgency} → ${level}`,
    };
  }
  const fallback = baseLevel(input.matrix, DEFAULT_IMPACT, DEFAULT_URGENCY) ?? 'medium';
  return {
    impact: DEFAULT_IMPACT,
    urgency: DEFAULT_URGENCY,
    level: fallback,
    rule: `${DEFAULT_IMPACT} × ${DEFAULT_URGENCY} → ${fallback} (по умолчанию)`,
    reason: 'влияние и срочность не определены — средний по умолчанию',
  };
}

/**
 * Приоритет по матрице «влияние × срочность» и поправки кодом:
 * авария → «Авария», массовость → «Авария», критичное оборудование → +1 уровень.
 * Тональность и указания из текста не участвуют: на вход только поля и черновик.
 */
export function computePriority(input: PriorityInput): PriorityVerdict {
  const base = chooseBase(input);
  const reasons = [base.reason];
  let level = base.level;

  if (input.criticality === 'critical') {
    const raised = raise(input.matrix, level);
    if (raised && raised !== level) {
      reasons.push(`критичное оборудование: ${level} → ${raised}`);
      level = raised;
    } else {
      reasons.push('критичное оборудование: уровень уже высший');
    }
  }

  if (input.incident) {
    if (level !== 'emergency') reasons.push('массовость: обращение связано с инцидентом');
    level = 'emergency';
  }

  if (input.emergencyLevel !== 'none') {
    reasons.push(`авария (${input.emergencyLevel}): приоритет «Авария»`);
    level = 'emergency';
  }

  const def = input.matrix.levels[level];
  if (!def) throw new Error(`в матрице приоритета нет уровня «${level}»`);

  return {
    value: level,
    reactDueAt: dueAt(input.now, def.reactMinutes),
    slaDueAt: dueAt(input.now, def.slaMinutes),
    rule: base.rule,
    reasons,
  };
}

/** Совпадение уровня с эталоном: метрика `priority`. */
export function evaluatePriority(expected: unknown, draft: { priority?: PriorityVerdict }): Metric[] {
  if (typeof expected !== 'object' || expected === null) return [];
  const wanted = PriorityLevelSchema.safeParse((expected as { priority?: unknown }).priority);
  if (!wanted.success) return [];
  const actual = draft.priority?.value;
  const passed = actual === wanted.data;
  return [{ key: 'priority', value: passed ? 1 : 0, expected: wanted.data, passed }];
}
