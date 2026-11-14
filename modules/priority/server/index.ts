import type { PriorityVerdict } from '@ugra/contracts';
import type { PipelineStep } from '@ugra/core';
import { defineModule } from '@ugra/core';
import { ExtractionCmdbHint, PriorityMatrix } from '../contracts';
import { computePriority, evaluatePriority } from './compute';

function fieldText(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return null;
}

function readCriticality(ext: Record<string, unknown>): 'low' | 'medium' | 'high' | 'critical' | null {
  const parsed = ExtractionCmdbHint.safeParse(ext);
  return parsed.success ? (parsed.data.extraction?.cmdb?.criticality ?? null) : null;
}

const computeStep: PipelineStep = {
  id: 'priority.compute',
  title: 'Считаем приоритет по матрице',
  stage: 'assess',
  order: 200,
  reads: ['fields', 'emergency'],
  writes: ['priority'],
  async run(ctx) {
    const parsed = PriorityMatrix.safeParse(ctx.data.extra.priorityMatrix);
    if (!parsed.success) {
      throw new Error('нет матрицы приоритета: data/priority-matrix.json не загружена');
    }
    const verdict: PriorityVerdict = computePriority({
      impact: fieldText(ctx.draft.fields.impact?.value),
      urgency: fieldText(ctx.draft.fields.urgency?.value),
      emergencyLevel: ctx.draft.emergency?.level ?? 'none',
      incident: ctx.draft.incident !== undefined,
      criticality: readCriticality(ctx.draft.ext),
      now: ctx.ports.clock.now(),
      matrix: parsed.data,
    });
    ctx.progress({
      stepId: 'priority.compute',
      status: 'progress',
      message: `Приоритет: ${verdict.value} — ${verdict.rule}`,
    });
    return { priority: verdict };
  },
  evaluate(expected, draft) {
    return evaluatePriority(expected, draft);
  },
};

export default defineModule({
  id: 'priority',
  title: 'Приоритет по матрице',
  enabledByDefault: true,
  // Поля impact/urgency живут в общем реестре data/fields.json (задача 008), модуль ими пользуется.
  fields: [],
  steps: [computeStep],
});
