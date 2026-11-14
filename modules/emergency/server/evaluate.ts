import type { AnalysisDraft, Metric } from '@ugra/contracts';

/**
 * Метрика «Авария» из `expected.emergency`: пропуск аварии — самое дорогое,
 * поэтому сравнение строгое (авария есть / аварии нет).
 */
export function evaluateEmergency(expected: unknown, draft: AnalysisDraft): Metric[] {
  if (typeof expected !== 'object' || expected === null) return [];
  const wanted = (expected as { emergency?: unknown }).emergency;
  if (typeof wanted !== 'boolean') return [];

  const actual = (draft.emergency?.level ?? 'none') !== 'none';
  const passed = actual === wanted;
  return [
    {
      key: 'emergency_match',
      value: passed ? 1 : 0,
      expected: wanted ? 'true' : 'false',
      passed,
    },
  ];
}
