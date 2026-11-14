import type { Fact, KernelStore, ReferenceData, ReportDef } from '@ugra/core';
import { defineModule } from '@ugra/core';
import {
  WorkloadParams,
  WorkloadResult,
  WorkloadRun,
  type WorkloadResult as WorkloadResultType,
} from '../contracts';
import { computeWorkload } from './compute';
import { buildCsv } from './csv';
import { generateInsight, templateInsight } from './insight';

/** Отчёт О4 «Нагрузка инженеров»: кто перегружен, кто свободен и как сбалансированы подразделения. */
export const INSIGHT_PROMPT_ID = 'modules/report-workload/prompts/insight.v1.md';

export const workloadReport: ReportDef<WorkloadParams, WorkloadResultType> = {
  id: 'workload.load',
  title: 'Нагрузка инженеров (О4)',
  question: 'Кто перегружен, кого можно загрузить и где перекос между подразделениями?',
  params: WorkloadParams,
  result: WorkloadResult,
  async compute(params, deps) {
    return computeWorkload(WorkloadParams.parse(params), {
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
export function factsOf(result: WorkloadResultType): Fact[] {
  const summary = result.summary;
  const busiest = result.byEngineer.find((row) => row.assigneeId !== null) ?? result.byEngineer[0];
  const free = [...result.byEngineer]
    .filter((row) => row.assigneeId !== null && !row.overload)
    .sort((left, right) => left.open - right.open)[0];
  const topDepartment = result.byDepartment[0];
  const facts: Fact[] = [
    { label: 'Период, дней', value: result.period.days },
    { label: 'Открытых заявок', value: summary.totalOpen },
    { label: 'Закрыто за период', value: summary.totalClosed },
    { label: 'Инженеров с заявками', value: summary.engineers },
    { label: 'Перегружено инженеров', value: summary.overloaded },
    { label: 'Порог перегруза, открытых', value: summary.overloadThreshold },
    { label: 'Открытых на инженера', value: summary.avgOpenPerEngineer },
    {
      label: 'Среднее время решения, мин',
      value: summary.avgResolutionMinutes ?? 'нет данных',
    },
  ];
  if (busiest) facts.push({ label: `Больше всего открытых: ${busiest.name}`, value: busiest.open });
  if (free) facts.push({ label: `Меньше всего открытых: ${free.name}`, value: free.open });
  if (topDepartment) {
    facts.push({
      label: `Больше всего открытых в подразделении: ${topDepartment.label}`,
      value: topDepartment.open,
    });
  }
  return facts;
}

/** Клик по цифре: фильтр заявок, который откроет очередь. */
export function drilldownOf(
  result: WorkloadResultType,
  key: string,
): Record<string, unknown> {
  const days = result.period.days;
  if (key === 'overload') return { days, overloaded: true };
  if (key === 'open') return { days, open: true };
  if (key === 'closed') return { days, closed: true };
  if (key.startsWith('assignee:')) {
    const assigneeId = key.slice('assignee:'.length);
    return { days, ...(assigneeId === 'none' ? {} : { assigneeId }) };
  }
  if (key.startsWith('department:')) {
    const departmentId = key.slice('department:'.length);
    return { days, ...(departmentId === 'none' ? {} : { departmentId }) };
  }
  return { days };
}

function text(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

function paramsFromQuery(query: Record<string, string>): WorkloadParams {
  return WorkloadParams.parse({
    days: text(query['days']),
    departmentId: text(query['departmentId']),
  });
}

function badRequest(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 400 });
}

export default defineModule({
  id: 'report-workload',
  title: 'Отчёт О4: нагрузка инженеров',
  enabledByDefault: true,
  reports: [workloadReport],
  routes(router, deps) {
    const run = async (params: WorkloadParams, withAi: boolean) => {
      const report = await computeWorkload(params, {
        db: deps.db,
        data: deps.data,
        clock: deps.clock,
      });
      const facts = factsOf(report);
      const fallback = templateInsight(report);
      const insight = withAi
        ? await generateInsight(deps.ports.llm, facts, fallback, {
            title: workloadReport.title,
            question: workloadReport.question,
            promptId: INSIGHT_PROMPT_ID,
          })
        : fallback;
      return { report, facts, insight };
    };

    router.get(
      '/',
      'reports',
      async ({ query }) => run(paramsFromQuery(query), false),
      { response: WorkloadRun },
    );

    router.post(
      '/run',
      'reports',
      async ({ body }) => run(WorkloadParams.parse(body ?? {}), true),
      { body: WorkloadParams, response: WorkloadRun },
    );

    router.get('/export', 'reports', async ({ query }) => {
      const format = text(query['format'])?.toLowerCase() ?? 'csv';
      if (format !== 'csv') {
        throw badRequest('Поддерживается только выгрузка в CSV: format=csv');
      }
      const report = await computeWorkload(paramsFromQuery(query), {
        db: deps.db,
        data: deps.data,
        clock: deps.clock,
      });
      return buildCsv(report);
    });
  },
});
