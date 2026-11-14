import type { AnalysisDraft, Metric } from '@ugra/contracts';
import type { PipelineStep, StepContext } from '@ugra/core';
import { defineModule } from '@ugra/core';
import { CandidatesResponse, type EngineerProfile } from '../contracts';
import { readEngineers } from './engineers';
import { scoreCandidates } from './scoring';

/** Значение поля заявки → строка для подбора (числа тоже встречаются: кабинет, корпус). */
function asText(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return null;
}

function candidatesFor(
  engineers: readonly EngineerProfile[],
  fields: {
    category?: unknown;
    equipment?: unknown;
    building?: unknown;
    text?: string | null;
    emergency?: boolean;
  },
) {
  return scoreCandidates({
    engineers,
    category: asText(fields.category),
    equipment: asText(fields.equipment),
    building: asText(fields.building),
    text: fields.text ?? '',
    emergency: fields.emergency ?? false,
  });
}

function isEmergency(ctx: StepContext): boolean {
  return (ctx.draft.emergency?.level ?? 'none') !== 'none';
}

/** Топ-3 исполнителя с объяснением: весь расчёт — код, объяснение собирается из факторов. */
const recommendStep: PipelineStep = {
  id: 'routing.recommend',
  title: 'Подбираем исполнителя',
  stage: 'route',
  order: 100,
  reads: ['fields', 'emergency'],
  writes: ['assignees'],
  async run(ctx) {
    const candidates = candidatesFor(readEngineers(ctx.data), {
      category: ctx.draft.fields.category?.value,
      equipment: ctx.draft.fields.equipment?.value,
      building: ctx.draft.fields.building?.value,
      text: ctx.appeal.originalText,
      emergency: isEmergency(ctx),
    });
    ctx.progress({
      stepId: 'routing.recommend',
      status: 'progress',
      message:
        candidates.length > 0 ? `Кандидатов: ${candidates.length}` : 'Кандидатов нет — выбирает диспетчер',
    });
    return { assignees: candidates };
  },
  async fallback() {
    return { assignees: [] };
  },
  evaluate(expected: unknown, draft: AnalysisDraft): Metric[] {
    const expectedTop3 = expectedIds(expected);
    if (expectedTop3.length === 0) return [];
    const got = draft.assignees ?? [];
    const top1 = got[0]?.userId;
    const top3 = got.slice(0, 3).map((candidate) => candidate.userId);
    const hitTop1 = top1 !== undefined && expectedTop3.includes(top1);
    const hitTop3 = top3.some((userId) => expectedTop3.includes(userId));
    return [
      { key: 'assignee_top1', value: hitTop1 ? 1 : 0, expected: expectedTop3[0], passed: hitTop1 },
      { key: 'assignee_top3', value: hitTop3 ? 1 : 0, expected: expectedTop3.join(', '), passed: hitTop3 },
    ];
  },
};

/** Эталонный топ из `expected.assigneeTop3`; нет эталона — метрик нет. */
function expectedIds(expected: unknown): string[] {
  if (typeof expected !== 'object' || expected === null) return [];
  const raw = (expected as { assigneeTop3?: unknown }).assigneeTop3;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === 'string');
}

/** Поля заявки из базы в том же виде, что и в черновике. */
function fieldsOfTicket(rows: readonly { fieldKey: string; value: string | number | null }[]) {
  const result: Record<string, string | number | null> = {};
  for (const row of rows) result[row.fieldKey] = row.value;
  return result;
}

export default defineModule({
  id: 'routing',
  title: 'Подбор исполнителя',
  enabledByDefault: true,
  steps: [recommendStep],
  routes(router, deps) {
    router.get(
      '/candidates/:ticketId',
      'tickets.read',
      async ({ params }) => {
        const ticketId = params.ticketId;
        if (!ticketId) throw new Error('Не указана заявка');
        const ticket = await deps.db.getTicket(ticketId);
        if (!ticket) throw new Error(`Заявка ${ticketId} не найдена`);
        const fields = fieldsOfTicket(await deps.db.getTicketFields(ticket.id));
        const appeal = await deps.db.getAppeal(ticket.appealId);
        const candidates = candidatesFor(readEngineers(deps.data), {
          category: fields.category ?? ticket.category,
          equipment: fields.equipment,
          building: fields.building,
          text: appeal?.originalText ?? '',
        });
        return { candidates } satisfies CandidatesResponse;
      },
      { response: CandidatesResponse },
    );
  },
  async seed() {
    // Данные инженеров приходят из `data/engineers.json` (задача 008) — своих таблиц у модуля нет.
  },
});
