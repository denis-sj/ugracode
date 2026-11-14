import type { Fact, KernelStore, ReferenceData, ReportDef } from '@ugra/core';
import { defineModule } from '@ugra/core';
import {
  AiEffectParams,
  AiEffectResult,
  AiEffectRun,
  type AiEffectResult as AiEffectResultType,
} from '../contracts';
import { computeAiEffect } from './compute';
import { buildCsv } from './csv';
import { generateInsight, templateInsight } from './insight';

/** Отчёт О5 «Эффект ИИ»: доля полей без правок, время до подтверждения, что улучшить. */
export const INSIGHT_PROMPT_ID = 'modules/report-ai-effect/prompts/insight.v1.md';

export const aiEffectReport: ReportDef<AiEffectParams, AiEffectResultType> = {
  id: 'ai-effect.summary',
  title: 'Эффект ИИ (О5)',
  question: 'Сколько ИИ делает без правок человеком и где он ошибается?',
  params: AiEffectParams,
  result: AiEffectResult,
  async compute(params, deps) {
    return computeAiEffect(AiEffectParams.parse(params), {
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
export function factsOf(result: AiEffectResultType): Fact[] {
  const totals = result.totals;
  const top = totals.correctionsByField[0];
  const facts: Fact[] = [
    { label: 'Период, дней', value: result.period.days },
    { label: 'Заявок с подсказками ИИ', value: totals.ticketsWithAi },
    { label: 'Полей предложено ИИ', value: totals.fieldsSuggested },
    { label: 'Полей исправлено человеком', value: totals.fieldsCorrected },
    { label: 'Заявок без правок', value: totals.ticketsWithoutEdits },
    { label: 'Без правок, %', value: totals.shareWithoutEditsPercent ?? 'нет данных' },
    {
      label: 'Среднее число правок на заявку',
      value: totals.avgCorrectionsPerTicket ?? 'нет данных',
    },
    {
      label: 'Среднее время до подтверждения, мин',
      value: totals.avgMinutesToConfirm ?? 'нет данных',
    },
    { label: 'Подтверждённых заявок', value: totals.confirmedTickets },
    {
      label: 'Сравнение с ручным режимом',
      value: result.comparison.withoutAi === null ? 'нет данных' : result.comparison.note,
    },
  ];
  if (top) {
    facts.push({ label: 'Чаще всего исправляют', value: `${top.label} — ${top.corrections}` });
  }
  return facts;
}

/** Клик по цифре: фильтр заявок для очереди. */
export function drilldownOf(result: AiEffectResultType, key: string): Record<string, unknown> {
  const days = result.period.days;
  if (key === 'without-edits') return { days, corrected: false };
  if (key === 'edited') return { days, corrected: true };
  return { days };
}

function text(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

function paramsFromQuery(query: Record<string, string>): AiEffectParams {
  return AiEffectParams.parse({ days: text(query['days']) });
}

function badRequest(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 400 });
}

export default defineModule({
  id: 'report-ai-effect',
  title: 'Отчёт О5: эффект ИИ',
  enabledByDefault: true,
  reports: [aiEffectReport],
  routes(router, deps) {
    const run = async (params: AiEffectParams, withAi: boolean) => {
      const report = await computeAiEffect(params, {
        db: deps.db,
        data: deps.data,
        clock: deps.clock,
      });
      const facts = factsOf(report);
      const fallback = templateInsight(report);
      const insight = withAi
        ? await generateInsight(deps.ports.llm, facts, fallback, {
            title: aiEffectReport.title,
            question: aiEffectReport.question,
            promptId: INSIGHT_PROMPT_ID,
          })
        : fallback;
      return { report, facts, insight };
    };

    router.get(
      '/',
      'reports',
      async ({ query }) => run(paramsFromQuery(query), false),
      { response: AiEffectRun },
    );

    router.post(
      '/run',
      'reports',
      async ({ body }) => run(AiEffectParams.parse(body ?? {}), true),
      { body: AiEffectParams, response: AiEffectRun },
    );

    router.get('/export', 'reports', async ({ query }) => {
      const format = text(query['format'])?.toLowerCase() ?? 'csv';
      if (format !== 'csv') {
        throw badRequest('Поддерживается только выгрузка в CSV: format=csv');
      }
      const report = await computeAiEffect(paramsFromQuery(query), {
        db: deps.db,
        data: deps.data,
        clock: deps.clock,
      });
      return buildCsv(report);
    });
  },
});
