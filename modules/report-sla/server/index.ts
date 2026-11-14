import type { Fact, KernelStore, ReferenceData, ReportDef } from '@ugra/core';
import { defineModule } from '@ugra/core';
import { SlaParams, SlaResult, SlaRun, type SlaResult as SlaResultType } from '../contracts';
import { computeSla } from './compute';
import { buildCsv } from './csv';
import { generateInsight, templateInsight } from './insight';

/** Отчёт О3 «Сроки (SLA)»: доля в срок, нарушения, разрезы и худшие заявки. */
export const INSIGHT_PROMPT_ID = 'modules/report-sla/prompts/insight.v1.md';

export const slaReport: ReportDef<SlaParams, SlaResultType> = {
  id: 'sla.summary',
  title: 'Сроки (SLA) (О3)',
  question: 'Где мы опаздываем по срокам и какие заявки горят прямо сейчас?',
  params: SlaParams,
  result: SlaResult,
  async compute(params, deps) {
    return computeSla(SlaParams.parse(params), {
      db: deps.db as KernelStore,
      data: deps.data as ReferenceData | undefined,
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
export function factsOf(result: SlaResultType): Fact[] {
  const summary = result.summary;
  const worstPriority = [...result.byPriority].sort((left, right) => right.breaches - left.breaches)[0];
  const worstDepartment = [...result.byDepartment].sort(
    (left, right) => right.breaches - left.breaches,
  )[0];
  const worstTicket = result.worst[0];
  const facts: Fact[] = [
    { label: 'Период, дней', value: result.period.days },
    { label: 'Заявок за период', value: summary.total },
    { label: 'Закрыто заявок', value: summary.closed },
    { label: 'Открыто заявок', value: summary.open },
    { label: 'В срок закрыто, %', value: summary.slaOnTimePercent ?? 'нет данных' },
    { label: 'Нарушений срока', value: summary.lateClosed + summary.openOverdue },
    { label: 'Закрыто с просрочкой', value: summary.lateClosed },
    { label: 'Открытых просрочено', value: summary.openOverdue },
    { label: 'Под риском просрочки', value: summary.atRisk },
    { label: 'Средняя просрочка закрытых, мин', value: summary.avgLateMinutes ?? 'нет данных' },
    {
      label: 'Среднее время реакции, мин',
      value: summary.avgReactionMinutes ?? 'нет данных',
    },
    {
      label: 'Среднее время решения, мин',
      value: summary.avgResolutionMinutes ?? 'нет данных',
    },
    {
      label: 'Реакция в срок, %',
      value: summary.reactionOnTimePercent ?? 'нет данных',
    },
    { label: 'Реакция измерена по заявкам', value: summary.reactionMeasured },
  ];
  if (worstPriority) {
    facts.push({
      label: `Больше всего нарушений: ${worstPriority.label}`,
      value: worstPriority.breaches,
    });
  }
  if (worstDepartment && worstDepartment.breaches > 0) {
    facts.push({
      label: `Худшее подразделение: ${worstDepartment.label}`,
      value: worstDepartment.breaches,
    });
  }
  if (worstTicket) {
    facts.push({
      label: 'Худшая заявка',
      value: `${worstTicket.number} — просрочка ${worstTicket.lateMinutes} мин`,
    });
  }
  return facts;
}

/** Клик по цифре: фильтр заявок, который откроет очередь или список истории. */
export function drilldownOf(result: SlaResultType, key: string): Record<string, unknown> {
  const days = result.period.days;
  if (key === 'late') return { days, slaState: 'late' };
  if (key === 'overdue') return { days, slaState: 'overdue' };
  if (key === 'at-risk') return { days, slaState: 'at-risk' };
  if (key === 'reaction') return { days, reactionKnown: true };
  if (key.startsWith('priority:')) {
    const priority = key.slice('priority:'.length);
    return { days, ...(priority === 'none' ? {} : { priority }) };
  }
  if (key.startsWith('department:')) {
    const departmentId = key.slice('department:'.length);
    return { days, ...(departmentId === 'none' ? {} : { departmentId }) };
  }
  if (key.startsWith('ticket:')) return { ticketId: key.slice('ticket:'.length) };
  return { days };
}

function text(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

function paramsFromQuery(query: Record<string, string>): SlaParams {
  return SlaParams.parse({
    days: text(query['days']),
    priority: text(query['priority']),
    assigneeId: text(query['assigneeId']),
  });
}

function badRequest(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 400 });
}

export default defineModule({
  id: 'report-sla',
  title: 'Отчёт О3: сроки (SLA)',
  enabledByDefault: true,
  reports: [slaReport],
  routes(router, deps) {
    const run = async (params: SlaParams, withAi: boolean) => {
      const report = await computeSla(params, {
        db: deps.db,
        data: deps.data,
        clock: deps.clock,
      });
      const facts = factsOf(report);
      const fallback = templateInsight(report);
      const insight = withAi
        ? await generateInsight(deps.ports.llm, facts, fallback, {
            title: slaReport.title,
            question: slaReport.question,
            promptId: INSIGHT_PROMPT_ID,
          })
        : fallback;
      return { report, facts, insight };
    };

    router.get(
      '/',
      'reports',
      async ({ query }) => run(paramsFromQuery(query), false),
      { response: SlaRun },
    );

    router.post(
      '/run',
      'reports',
      async ({ body }) => run(SlaParams.parse(body ?? {}), true),
      { body: SlaParams, response: SlaRun },
    );

    router.get('/export', 'reports', async ({ query }) => {
      const format = text(query['format'])?.toLowerCase() ?? 'csv';
      if (format !== 'csv') {
        throw badRequest('Поддерживается только выгрузка в CSV: format=csv');
      }
      const report = await computeSla(paramsFromQuery(query), {
        db: deps.db,
        data: deps.data,
        clock: deps.clock,
      });
      return buildCsv(report);
    });
  },
});
