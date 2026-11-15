import type { Fact, KernelStore, ReferenceData, ReportDef } from '@ugra/core';
import { defineModule } from '@ugra/core';
import {
  HotspotRow,
  HotspotsParams,
  HotspotsResult,
  HotspotsRun,
  type HotspotsResult as HotspotsResultType,
} from '../contracts';
import { computeHotspots } from './compute';
import { buildCsv } from './csv';
import { generateInsight, templateInsight } from './insight';

/** Отчёт О2 «Горячие точки оборудования»: повторные заявки по технике и кабинетам. */
export const INSIGHT_PROMPT_ID = 'modules/report-hotspots/prompts/insight.v1.md';

export const hotspotsReport: ReportDef<HotspotsParams, HotspotsResultType> = {
  id: 'hotspots.equipment',
  title: 'Горячие точки оборудования (О2)',
  question: 'Где техника ломается снова и снова и что с этим делать?',
  params: HotspotsParams,
  result: HotspotsResult,
  async compute(params, deps) {
    return computeHotspots(HotspotsParams.parse(params), {
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

/** Минуты → «12 ч 46 мин», «45 мин», «2 дн 3 ч»: так время читается с первого взгляда. */
export function durationText(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const rest = total % 60;
  if (days > 0) return hours > 0 ? `${days} дн ${hours} ч` : `${days} дн`;
  if (hours > 0) return rest > 0 ? `${hours} ч ${rest} мин` : `${hours} ч`;
  return `${rest} мин`;
}

/** Только эти пары «показатель → значение» увидит модель вывода. */
export function factsOf(result: HotspotsResultType): Fact[] {
  const facts: Fact[] = [
    { label: 'Период, дней', value: result.period.days },
    { label: 'Заявок за период', value: result.total },
    { label: 'Заявок в прошлом периоде', value: result.previousTotal },
    {
      label: 'Изменение числа заявок, %',
      value: result.trendPercent ?? 'нет данных',
    },
    { label: 'Заявок в точках с повторами', value: result.repeatedTickets },
  ];
  // Подписи — сами места, а не «Точка 1»: модель пересказывает факты, и руководитель читает понятный текст.
  for (const row of result.rows.slice(0, 3)) {
    facts.push({ label: `${row.label}: заявок`, value: row.count });
    facts.push({ label: `${row.label}: доля, %`, value: row.sharePercent });
    facts.push({
      label: `${row.label}: среднее решение`,
      value: row.avgResolutionMinutes === null ? 'нет данных' : durationText(row.avgResolutionMinutes),
    });
  }
  const top = result.rows[0];
  facts.push({
    label: 'Главная точка',
    value: top ? `${top.label} — ${top.count}` : 'нет',
  });
  return facts;
}

/** Клик по цифре: фильтр заявок, который откроет очередь или список истории. */
export function drilldownOf(result: HotspotsResultType, key: string): Record<string, unknown> {
  if (key === 'total') return { days: result.period.days };
  const row: HotspotRow | undefined = result.rows.find((item) => item.key === key);
  if (!row) return { days: result.period.days };
  return {
    days: result.period.days,
    building: row.building,
    ...(row.cabinet ? { cabinet: row.cabinet } : {}),
    ...(row.category ? { category: row.category } : {}),
    ...(row.equipmentId ? { equipmentId: row.equipmentId } : {}),
  };
}

function text(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

function paramsFromQuery(query: Record<string, string>): HotspotsParams {
  return HotspotsParams.parse({
    days: text(query['days']),
    building: text(query['building']),
    category: text(query['category']),
  });
}

function badRequest(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 400 });
}

export default defineModule({
  id: 'report-hotspots',
  title: 'Отчёт О2: горячие точки оборудования',
  enabledByDefault: true,
  reports: [hotspotsReport],
  routes(router, deps) {
    const run = async (params: HotspotsParams, withAi: boolean) => {
      const report = await computeHotspots(params, {
        db: deps.db,
        data: deps.data,
        clock: deps.clock,
      });
      const facts = factsOf(report);
      const fallback = templateInsight(report);
      const insight = withAi
        ? await generateInsight(deps.ports.llm, facts, fallback, {
            title: hotspotsReport.title,
            question: hotspotsReport.question,
            promptId: INSIGHT_PROMPT_ID,
          })
        : fallback;
      return { report, facts, insight };
    };

    router.get(
      '/',
      'reports',
      async ({ query }) => run(paramsFromQuery(query), false),
      { response: HotspotsRun },
    );

    router.post(
      '/run',
      'reports',
      async ({ body }) => run(HotspotsParams.parse(body ?? {}), true),
      { body: HotspotsParams, response: HotspotsRun },
    );

    router.get('/export', 'reports', async ({ query }) => {
      const format = text(query['format'])?.toLowerCase() ?? 'csv';
      if (format !== 'csv') {
        throw badRequest('Поддерживается только выгрузка в CSV: format=csv');
      }
      const report = await computeHotspots(paramsFromQuery(query), {
        db: deps.db,
        data: deps.data,
        clock: deps.clock,
      });
      return buildCsv(report);
    });
  },
});
