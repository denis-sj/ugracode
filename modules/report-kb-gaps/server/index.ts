import type { Fact, KernelStore, ReferenceData, ReportDef } from '@ugra/core';
import { defineModule } from '@ugra/core';
import {
  KbGapsParams,
  KbGapsResult,
  KbGapsRun,
  type KbGapsResult as KbGapsResultType,
} from '../contracts';
import { analysisOf, computeKbGaps } from './compute';
import { buildCsv } from './csv';
import { generateInsight, templateInsight } from './insight';

/** Отчёт О6 «Пробелы базы знаний»: какие симптомы остаются без статьи и что написать. */
export const INSIGHT_PROMPT_ID = 'modules/report-kb-gaps/prompts/insight.v1.md';

/** Подписчик пишет это событие для каждой заявки, где статья не нашлась. */
export const MISS_EVENT = 'report-kb-gaps.miss';

export const kbGapsReport: ReportDef<KbGapsParams, KbGapsResultType> = {
  id: 'kb-gaps.articles',
  title: 'Пробелы базы знаний (О6)',
  question: 'Каких статей не хватает и какие обращения из-за этого решают вручную?',
  params: KbGapsParams,
  result: KbGapsResult,
  async compute(params, deps) {
    return computeKbGaps(KbGapsParams.parse(params), {
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
export function factsOf(result: KbGapsResultType): Fact[] {
  const summary = result.summary;
  const topTheme = result.themes[0];
  const topCategory = [...result.byCategory].sort(
    (left, right) => right.withoutArticle - left.withoutArticle,
  )[0];
  const facts: Fact[] = [
    { label: 'Период, дней', value: result.period.days },
    { label: 'Заявок за период', value: summary.total },
    { label: 'Заявок с разбором', value: summary.analyzed },
    { label: 'Заявок без статьи', value: summary.withoutArticle },
    {
      label: 'Доля заявок без статьи, %',
      value: summary.shareWithoutArticlePercent ?? 'нет данных',
    },
    { label: 'Тем для пополнения базы', value: summary.themes },
    { label: 'Пропусков из подписчика', value: summary.fromJournal },
    { label: 'Проверено поиском по базе', value: summary.fromKnowledgeBase },
  ];
  if (topTheme) {
    facts.push({ label: `Самая частая тема: ${topTheme.label}`, value: topTheme.count });
  }
  if (topCategory && topCategory.withoutArticle > 0) {
    facts.push({
      label: `Больше всего пробелов: ${topCategory.label}`,
      value: topCategory.withoutArticle,
    });
  }
  return facts;
}

/** Клик по цифре: фильтр заявок для очереди или список темы. */
export function drilldownOf(result: KbGapsResultType, key: string): Record<string, unknown> {
  const days = result.period.days;
  if (key === 'without-article') return { days, hasArticle: false };
  if (key === 'with-article') return { days, hasArticle: true };
  if (key.startsWith('category:')) {
    const category = key.slice('category:'.length);
    return { days, ...(category === 'none' ? {} : { category }) };
  }
  if (key.startsWith('theme:')) {
    const theme = result.themes.find((row) => row.key === key);
    if (theme) {
      return {
        days,
        symptom: theme.symptom,
        ...(theme.category ? { category: theme.category } : {}),
      };
    }
  }
  return { days };
}

function text(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

function paramsFromQuery(query: Record<string, string>): KbGapsParams {
  return KbGapsParams.parse({ days: text(query['days']) });
}

function badRequest(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 400 });
}

export default defineModule({
  id: 'report-kb-gaps',
  title: 'Отчёт О6: пробелы базы знаний',
  enabledByDefault: true,
  reports: [kbGapsReport],
  events: [
    {
      type: MISS_EVENT,
      description: 'Разбор завершён, но подходящей статьи в базе знаний не нашлось: симптом и категория',
    },
  ],
  subscribers: [
    {
      on: 'analysis.completed',
      async handle(event, deps) {
        if (!event.ticketId) return;
        const info = analysisOf(event.payload);
        if (info.hasArticle === true) return;
        try {
          await deps.bus.publish({
            type: MISS_EVENT,
            actor: { kind: 'system' },
            ticketId: event.ticketId,
            payload: { symptom: info.symptom, category: info.category },
          });
        } catch {
          // журнал и подписчики не должны валить разбор обращения
        }
      },
    },
  ],
  routes(router, deps) {
    const run = async (params: KbGapsParams, withAi: boolean) => {
      const report = await computeKbGaps(params, {
        db: deps.db,
        data: deps.data,
        clock: deps.clock,
      });
      const facts = factsOf(report);
      const fallback = templateInsight(report);
      const insight = withAi
        ? await generateInsight(deps.ports.llm, facts, fallback, {
            title: kbGapsReport.title,
            question: kbGapsReport.question,
            promptId: INSIGHT_PROMPT_ID,
          })
        : fallback;
      return { report, facts, insight };
    };

    router.get(
      '/',
      'reports',
      async ({ query }) => run(paramsFromQuery(query), false),
      { response: KbGapsRun },
    );

    router.post(
      '/run',
      'reports',
      async ({ body }) => run(KbGapsParams.parse(body ?? {}), true),
      { body: KbGapsParams, response: KbGapsRun },
    );

    router.get('/export', 'reports', async ({ query }) => {
      const format = text(query['format'])?.toLowerCase() ?? 'csv';
      if (format !== 'csv') {
        throw badRequest('Поддерживается только выгрузка в CSV: format=csv');
      }
      const report = await computeKbGaps(paramsFromQuery(query), {
        db: deps.db,
        data: deps.data,
        clock: deps.clock,
      });
      return buildCsv(report);
    });
  },
});
