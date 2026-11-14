import { EmergencySign } from '@ugra/contracts';
import { z } from 'zod';

/**
 * Схемы модуля `emergency`.
 *
 * Файл `data/emergency-rules.json` состоит из двух разделов: `rules` (признаки аварии) и
 * `checklists` (шаги регламента). Признак правила в данных — код (`"smoke"`), а слова и шаблоны
 * лежат на уровне правила; поэтому знак правила — либо строка-код, либо объект с собственными
 * словами и шаблонами (так правило можно описать точнее, не меняя файл данных).
 */

/** Признак правила: код признака или код вместе со своими словами и regex-шаблонами. */
export const EmergencyRuleSign = z.union([
  z.string().min(1),
  z.object({
    sign: z.string().min(1),
    words: z.array(z.string().min(1)).default([]),
    patterns: z.array(z.string().min(1)).default([]),
  }),
]);
export type EmergencyRuleSign = z.infer<typeof EmergencyRuleSign>;

/** Правило аварии: что искать в тексте, какой чек-лист показать и кого уведомить. */
export const EmergencyRule = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  level: z.enum(['critical', 'high', 'medium', 'low']).default('critical'),
  /** Ссылка на чек-лист в разделе `checklists`. */
  checklistId: z.string().min(1).optional(),
  /** Шаги чек-листа прямо в правиле — объединяются с чек-листом по `checklistId`. */
  checklist: z.array(z.string().min(1)).default([]),
  signs: z.array(EmergencyRuleSign).default([]),
  /** Слова правила (сравнение без регистра и «ё»). */
  words: z.array(z.string().min(1)).default([]),
  /** Regex-шаблоны правила; битый шаблон считается обычной подстрокой. */
  patterns: z.array(z.string().min(1)).default([]),
  /** Условие правила словами (в данных пока не задано): код его не вычисляет. */
  condition: z.string().min(1).optional(),
  /** Навыки дежурного, которому уходит уведомление; пусто — все на смене. */
  skills: z.array(z.string().min(1)).default([]),
});
export type EmergencyRule = z.infer<typeof EmergencyRule>;

/** Чек-лист действий из регламента. */
export const EmergencyChecklist = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  steps: z.array(z.string().min(1)).default([]),
});
export type EmergencyChecklist = z.infer<typeof EmergencyChecklist>;

/** Файл `data/emergency-rules.json` целиком. */
export const EmergencyRulesFile = z.object({
  rules: z.array(EmergencyRule).default([]),
  checklists: z.array(EmergencyChecklist).default([]),
});
export type EmergencyRulesFile = z.infer<typeof EmergencyRulesFile>;

const EMPTY_RULES: EmergencyRulesFile = { rules: [], checklists: [] };

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Чтение правил терпимо: битое правило или чек-лист отбрасывается по одному, а не весь файл.
 * Данных нет — пустой набор: аварии не будет, но шаг не упадёт.
 */
export function readEmergencyRules(raw: unknown): EmergencyRulesFile {
  if (raw === undefined || raw === null) return EMPTY_RULES;
  // Массив без обёртки встречается в тестовых данных — считаем его списком правил.
  const file = Array.isArray(raw) ? { rules: raw, checklists: [] } : asRecord(raw);
  if (!file) return EMPTY_RULES;

  const rules = asArray(file.rules).flatMap((item) => {
    const parsed = EmergencyRule.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
  const checklists = asArray(file.checklists).flatMap((item) => {
    const parsed = EmergencyChecklist.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
  return { rules, checklists };
}

/**
 * Дежурный инженер из `data/engineers.json` (`data.extra.engineers`).
 * Поле `level` профиля в данных бывает строкой («first_line»), поэтому здесь его нет.
 */
export const EmergencyEngineer = z.object({
  id: z.string().min(1),
  fullName: z.string().default(''),
  skills: z
    .array(
      z.object({
        skill: z.string().min(1),
        level: z.number().min(0).max(5).default(1),
      }),
    )
    .default([]),
  onShift: z.boolean().default(false),
});
export type EmergencyEngineer = z.infer<typeof EmergencyEngineer>;

/**
 * Чтение инженеров терпимо: массив или `{ engineers: [...] }`, битые профили отбрасываются.
 * Данных нет — никого не уведомляем (запасного получателя нет).
 */
export function readEmergencyEngineers(raw: unknown): EmergencyEngineer[] {
  const list = Array.isArray(raw) ? raw : asArray(asRecord(raw)?.engineers);
  return list.flatMap((item) => {
    const parsed = EmergencyEngineer.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

/** Мнение модели об аварии в `draft.ext.extraction.emergency` (данные модуля `extraction`). */
export const ExtractionEmergencyHint = z.object({
  extraction: z
    .object({
      emergency: z
        .object({
          suspected: z.boolean().default(false),
          signs: z.array(EmergencySign).default([]),
          confidence: z.number().min(0).max(1).default(0),
        })
        .optional(),
    })
    .optional(),
});
export type ExtractionEmergencyHint = z.infer<typeof ExtractionEmergencyHint>;

export interface ModelEmergencySignal {
  suspected: boolean;
  signs: EmergencySign[];
  confidence: number;
}

const NO_MODEL_SIGNAL: ModelEmergencySignal = { suspected: false, signs: [], confidence: 0 };

/** Сигнал модели терпимо к отсутствию аспекта: нет данных — сигнала нет. */
export function readModelEmergency(ext: unknown): ModelEmergencySignal {
  const parsed = ExtractionEmergencyHint.safeParse(ext);
  const emergency = parsed.success ? parsed.data.extraction?.emergency : undefined;
  if (!emergency) return NO_MODEL_SIGNAL;
  return {
    suspected: emergency.suspected,
    signs: emergency.signs.map((sign) => ({ ...sign })),
    confidence: emergency.confidence,
  };
}
