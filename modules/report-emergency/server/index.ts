import type { Fact, KernelStore, ReferenceData, ReportDef } from '@ugra/core';
import { defineModule } from '@ugra/core';
import {
  EmergencyParams,
  EmergencyResult,
  EmergencyRun,
  type EmergencyResult as EmergencyResultType,
} from '../contracts';
import { computeEmergency } from './compute';
import { buildCsv } from './csv';
import { generateInsight, templateInsight } from './insight';

/** Отчёт О7 «Аварии»: число и доля аварий, реакция, повторные аварии и ложные тревоги. */
export const INSIGHT_PROMPT_ID = 'modules/report-emergency/prompts/insight.v1.md';

export const emergencyReport: ReportDef<EmergencyParams, EmergencyResultType> = {
  id: 'emergency.summary',
  title: 'Аварии (О7)',
  question: 'Сколько было аварий, где они повторяются и сколько тревог оказались ложными?',
  params: EmergencyParams,
  result: EmergencyResult,
  async compute(params, deps) {
    return computeEmergency(EmergencyParams.parse(params), {
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
export function factsOf(result: EmergencyResultType): Fact[] {
  const summary = result.summary;
  const top = result.hotspots[0];
  const facts: Fact[] = [
    { label: 'Период, дней', value: result.period.days },
    { label: 'Заявок за период', value: summary.total },
    { label: 'Аварий', value: summary.emergency },
    { label: 'Доля аварий, %', value: summary.sharePercent ?? 'нет данных' },
    { label: 'Аварий закрыто', value: summary.closed },
    { label: 'Аварий открыто', value: summary.open },
    { label: 'Реакция измерена по авариям', value: summary.reactionMeasured },
    {
      label: 'Среднее время реакции, мин',
      value: summary.avgReactionMinutes ?? 'нет данных',
    },
    { label: 'Повторных точек', value: summary.repeatedHotspots },
    { label: 'Сигналов аварии', value: summary.detectedSignals },
    {
      label: 'Ложных тревог',
      value: summary.falseAlarms ?? 'нет данных',
    },
  ];
  if (top) facts.push({ label: `Главная точка: ${top.label}`, value: top.count });
  return facts;
}

/** Клик по цифре: фильтр заявок, который откроет очередь или хронологию. */
export function drilldownOf(
  result: EmergencyResultType,
  key: string,
): Record<string, unknown> {
  const days = result.period.days;
  if (key === 'emergency') return { days, isEmergency: true };
  if (key === 'repeated') return { days, isEmergency: true, repeated: true };
  if (key === 'false-alarms') return { days, level: 'suspected' };
  if (key === 'reaction') return { days, isEmergency: true, reactionKnown: true };
  if (key.startsWith('equipment:')) {
    return { days, equipmentId: key.slice('equipment:'.length) };
  }
  if (key.startsWith('location:')) {
    return { days, locationId: key.slice('location:'.length) };
  }
  if (key.startsWith('ticket:')) return { ticketId: key.slice('ticket:'.length) };
  return { days };
}

function text(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

function paramsFromQuery(query: Record<string, string>): EmergencyParams {
  return EmergencyParams.parse({ days: text(query['days']) });
}

function badRequest(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 400 });
}

export default defineModule({
  id: 'report-emergency',
  title: 'Отчёт О7: аварии',
  enabledByDefault: true,
  reports: [emergencyReport],
  routes(router, deps) {
    const run = async (params: EmergencyParams, withAi: boolean) => {
      const report = await computeEmergency(params, {
        db: deps.db,
        data: deps.data,
        clock: deps.clock,
      });
      const facts = factsOf(report);
      const fallback = templateInsight(report);
      const insight = withAi
        ? await generateInsight(deps.ports.llm, facts, fallback, {
            title: emergencyReport.title,
            question: emergencyReport.question,
            promptId: INSIGHT_PROMPT_ID,
          })
        : fallback;
      return { report, facts, insight };
    };

    router.get(
      '/',
      'reports',
      async ({ query }) => run(paramsFromQuery(query), false),
      { response: EmergencyRun },
    );

    router.post(
      '/run',
      'reports',
      async ({ body }) => run(EmergencyParams.parse(body ?? {}), true),
      { body: EmergencyParams, response: EmergencyRun },
    );

    router.get('/export', 'reports', async ({ query }) => {
      const format = text(query['format'])?.toLowerCase() ?? 'csv';
      if (format !== 'csv') {
        throw badRequest('Поддерживается только выгрузка в CSV: format=csv');
      }
      const report = await computeEmergency(paramsFromQuery(query), {
        db: deps.db,
        data: deps.data,
        clock: deps.clock,
      });
      return buildCsv(report);
    });
  },
});
