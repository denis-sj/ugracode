import type { Fact, KernelStore, ReportDef } from '@ugra/core';
import { defineModule } from '@ugra/core';
import {
  ShiftParams,
  ShiftResult,
  ShiftRun,
  type ShiftResult as ShiftResultType,
} from '../contracts';
import { computeShift } from './compute';
import { buildCsv } from './csv';
import { generateInsight, templateInsight } from './insight';

/** Отчёт О1 «Сводка смены»: итоги дня, нагрузка исполнителей и что требует внимания. */
export const INSIGHT_PROMPT_ID = 'modules/report-shift/prompts/insight.v1.md';

export const shiftReport: ReportDef<ShiftParams, ShiftResultType> = {
  id: 'shift.summary',
  title: 'Сводка смены (О1)',
  question: 'Что произошло за смену и что требует внимания прямо сейчас?',
  params: ShiftParams,
  result: ShiftResult,
  async compute(params, deps) {
    return computeShift(ShiftParams.parse(params), {
      db: deps.db as KernelStore,
      clock: deps.clock,
    });
  },
  facts: factsOf,
  insightPromptId: INSIGHT_PROMPT_ID,
  drilldown(result, key) {
    return drilldownOf(result, key);
  },
};

/** Только эти пары «показатель → значение» увидит модель вывода. */
export function factsOf(result: ShiftResultType): Fact[] {
  const leader = result.byAssignee[0];
  return [
    { label: 'Дата смены', value: result.period.date },
    { label: 'Всего заявок', value: result.totals.total },
    { label: 'Новых заявок', value: result.totals.created },
    { label: 'Закрытых заявок', value: result.totals.closed },
    { label: 'Аварий', value: result.totals.emergency },
    { label: 'Нарушений срока', value: result.totals.slaBreaches },
    { label: 'В срок, %', value: result.totals.slaOnTimePercent ?? 'нет данных' },
    { label: 'Просрочено', value: result.attention.overdueCount },
    { label: 'Ждут проверки', value: result.attention.waitingReviewCount },
    {
      label: 'Больше всего заявок',
      value: leader ? `${leader.name} — ${leader.total}` : 'нет данных',
    },
  ];
}

/** Клик по цифре: фильтр, с которым очередь откроет нужные заявки смены. */
export function drilldownOf(result: ShiftResultType, key: string): Record<string, unknown> {
  const date = result.period.date;
  if (key === 'overdue') return { date, overdue: true };
  if (key === 'waiting-review') return { date, status: 'in_review' };
  if (key === 'emergency') return { date, isEmergency: true };
  if (key.startsWith('assignee:')) {
    const assigneeId = key.slice('assignee:'.length);
    return { date, ...(assigneeId === '' ? {} : { assigneeId }) };
  }
  return { date };
}

function text(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

function paramsFromQuery(query: Record<string, string>): ShiftParams {
  return ShiftParams.parse({ date: text(query['date']) });
}

function badRequest(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 400 });
}

export default defineModule({
  id: 'report-shift',
  title: 'Отчёт О1: сводка смены',
  enabledByDefault: true,
  reports: [shiftReport],
  routes(router, deps) {
    const run = async (params: ShiftParams, withAi: boolean) => {
      const report = await computeShift(params, { db: deps.db, clock: deps.clock });
      const facts = factsOf(report);
      const fallback = templateInsight(report);
      const insight = withAi
        ? await generateInsight(deps.ports.llm, facts, fallback, {
            title: shiftReport.title,
            question: shiftReport.question,
            promptId: INSIGHT_PROMPT_ID,
          })
        : fallback;
      return { report, facts, insight };
    };

    router.get(
      '/',
      'reports',
      async ({ query }) => run(paramsFromQuery(query), false),
      { response: ShiftRun },
    );

    router.post(
      '/run',
      'reports',
      async ({ body }) => run(ShiftParams.parse(body ?? {}), true),
      { body: ShiftParams, response: ShiftRun },
    );

    router.get('/export', 'reports', async ({ query }) => {
      const format = text(query['format'])?.toLowerCase() ?? 'csv';
      if (format !== 'csv') {
        throw badRequest('Поддерживается только выгрузка в CSV: format=csv');
      }
      const report = await computeShift(paramsFromQuery(query), { db: deps.db, clock: deps.clock });
      return buildCsv(report);
    });
  },
});
