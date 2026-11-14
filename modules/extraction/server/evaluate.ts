import type { AnalysisDraft, Metric } from '@ugra/contracts';
import { normalizeText } from './rules';

/**
 * Режимы сравнения из реестра `data/fields.json` для `evaluate()`.
 * `evaluate(expected, draft)` в контракте шага не получает `ctx.data`, поэтому точные поля
 * перечислены здесь; базовую проверку по реестру делает модуль `quality` (014).
 */
const EXACT_KEYS = new Set([
  'serial',
  'inventoryNo',
  'ip',
  'errorCode',
  'category',
  'serviceType',
  'department',
  'impact',
  'urgency',
]);

function sameValue(key: string, expected: string, actual: string): boolean {
  if (EXACT_KEYS.has(key)) return expected.trim() === actual.trim();
  return normalizeText(expected) === normalizeText(actual);
}

function expectedFields(expected: unknown): Record<string, string | null> | null {
  if (typeof expected !== 'object' || expected === null) return null;
  const fields = (expected as { fields?: unknown }).fields;
  if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) return null;
  return fields as Record<string, string | null>;
}

/** Точность по полям эталона: метрика на каждое поле и общая доля. */
export function evaluateFields(expected: unknown, draft: AnalysisDraft): Metric[] {
  const reference = expectedFields(expected);
  if (!reference) return [];
  const keys = Object.keys(reference);
  if (keys.length === 0) return [];

  const metrics: Metric[] = [];
  let hits = 0;
  for (const key of keys) {
    const wanted = reference[key] ?? null;
    const actualValue = draft.fields[key]?.value;
    const actual = actualValue === null || actualValue === undefined ? null : String(actualValue);
    const hit = wanted === null ? actual === null : actual !== null && sameValue(key, wanted, actual);
    if (hit) hits += 1;
    metrics.push({
      key: `field_${key}`,
      value: hit ? 1 : 0,
      expected: wanted ?? '',
      passed: hit,
    });
  }
  metrics.push({ key: 'fields_accuracy', value: hits / keys.length });
  return metrics;
}
