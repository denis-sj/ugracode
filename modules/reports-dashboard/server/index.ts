import type { Fact, KernelStore, ReferenceData, ReportDef } from '@ugra/core';
import { defineModule } from '@ugra/core';
import {
  OverdueResult,
  OverviewParams,
  OverviewResult,
  type OverviewResult as OverviewResultType,
} from '../contracts';
import { computeOverdue, computeOverview } from './overview';

/** Отчёт О0 «Дашборд»: плитки, разрезы, тепловая карта и горячие точки. */
export const overviewReport: ReportDef<OverviewParams, OverviewResultType> = {
  id: 'dashboard.overview',
  title: 'Дашборд О0',
  question: 'Что происходит с обращениями за период и где узкие места?',
  params: OverviewParams,
  result: OverviewResult,
  async compute(params, deps) {
    return computeOverview(OverviewParams.parse(params), {
      db: deps.db as KernelStore,
      data: deps.data as ReferenceData | undefined,
      clock: deps.clock,
    });
  },
  facts(result) {
    return factsOf(result);
  },
};

/** Короткие пары «показатель → значение»: только их увидит модель вывода. */
export function factsOf(result: OverviewResultType): Fact[] {
  const leader = result.hotSpots[0];
  return [
    { label: 'Период, дней', value: result.period.days },
    { label: 'Всего обращений', value: result.totals.total },
    { label: 'Открытых', value: result.totals.open },
    { label: 'Закрытых', value: result.totals.closed },
    { label: 'Аварий', value: result.totals.emergency },
    {
      label: 'Среднее время решения, мин',
      value: result.avgResolutionMinutes ?? 'нет данных',
    },
    { label: 'В срок, %', value: result.totals.slaOnTimePercent ?? 'нет данных' },
    { label: 'Нарушений SLA', value: result.totals.slaBreaches },
    {
      label: 'Главная горячая точка',
      value: leader ? `${leader.label} — ${leader.count}` : 'нет',
    },
  ];
}

export default defineModule({
  id: 'reports-dashboard',
  title: 'Дашборд руководителя',
  enabledByDefault: true,
  reports: [overviewReport],
  routes(router, deps) {
    router.get(
      '/overview',
      'reports',
      async ({ query }) => {
        const params = OverviewParams.parse({
          days: query['days'],
          from: query['from'],
          to: query['to'],
          category: query['category'],
          assigneeId: query['assigneeId'],
          channel: query['channel'],
          building: query['building'],
          status: query['status'],
        });
        return computeOverview(params, {
          db: deps.db,
          data: deps.data,
          clock: deps.clock,
        });
      },
      { response: OverviewResult },
    );

    // Шторка «N просрочено →» на самом дашборде: список и группы по исполнителям.
    router.get(
      '/overdue',
      'reports',
      async ({ query }) => {
        const params = OverviewParams.parse({
          days: query['days'],
          from: query['from'],
          to: query['to'],
          category: query['category'],
          assigneeId: query['assigneeId'],
          channel: query['channel'],
          building: query['building'],
          status: query['status'],
        });
        return computeOverdue(params, {
          db: deps.db,
          data: deps.data,
          clock: deps.clock,
        });
      },
      { response: OverdueResult },
    );
  },
});
