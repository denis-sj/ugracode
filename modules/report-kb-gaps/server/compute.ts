import type { Ticket, TicketField } from '@ugra/contracts';
import type { KernelStore, ReferenceData } from '@ugra/core';
import type {
  KbGapsCategoryRow,
  KbGapsParams,
  KbGapsPeriod,
  KbGapsResult,
  KbGapsSummary,
  KbGapsTheme,
} from '../contracts';

/**
 * Расчёт О6 «Пробелы базы знаний». Цифры считает только код.
 *
 * Источник истины — журнал: `analysis.completed` хранит черновик разбора с `knowledge`,
 * а подписчик модуля пишет `report-kb-gaps.miss`, когда статьи не нашлось. Для заявок из
 * истории без разбора статью ищем по базе знаний тем же поиском, что у агента (`searchKnowledge`):
 * «нет статьи» = нет ни одного совпадения не ниже порога. Своих таблиц нет — журнал append-only.
 */

export interface KbGapsDeps {
  db: KernelStore;
  data?: ReferenceData;
  clock: { now(): Date };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS = 30;
const MAX_TICKETS = 100_000;
const MAX_EVENTS = 100_000;
const THEME_LIMIT = 10;
const DEFAULT_MIN_SCORE = 2;
const MAX_SYMPTOM_LENGTH = 120;
const NO_SYMPTOM = 'Симптом не указан';
const NO_SYMPTOM_KEY = 'no-symptom';

interface AnalysisInfo {
  hasArticle: boolean | null;
  symptom: string;
  category: string | null;
}

export type { AnalysisInfo };

interface TicketResult {
  hasArticle: boolean;
  source: 'analysis' | 'journal' | 'knowledge-base';
  symptom: string;
  category: string | null;
}

interface ThemeAccumulator {
  key: string;
  symptom: string;
  category: string | null;
  count: number;
  exampleTicketId: string | null;
  exampleNumber: string | null;
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function percent(part: number, total: number): number | null {
  return total === 0 ? null : round((part / total) * 100);
}

function periodOf(params: KbGapsParams, now: Date): KbGapsPeriod {
  const days = params.days ?? DEFAULT_DAYS;
  const to = now.getTime();
  return { from: new Date(to - days * DAY_MS).toISOString(), to: new Date(to).toISOString(), days };
}

function inPeriod(ticket: Ticket, from: number, to: number): boolean {
  const created = Date.parse(ticket.createdAt);
  return Number.isFinite(created) && created >= from && created <= to;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function valueText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

/** Значение поля из черновика разбора: `{ value, confidence, … }`. */
function draftField(draft: Record<string, unknown>, key: string): string {
  const fields = asRecord(draft['fields']);
  const field = asRecord(fields[key]);
  return valueText(field['value']);
}

/** Значение поля из таблицы заявки (`ticket_field`). */
function ticketField(fields: readonly TicketField[], key: string): string {
  const field = fields.find((item) => item.fieldKey === key);
  return field === undefined ? '' : valueText(field.value);
}

function symptomOf(read: (key: string) => string): string {
  const main = [read('symptoms'), read('object')]
    .map((part) => part.trim())
    .filter((part) => part !== '');
  const text = main.length > 0 ? main.join(', ') : read('equipment').trim();
  return text.slice(0, MAX_SYMPTOM_LENGTH);
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replaceAll('ё', 'е')
    .replaceAll(/\s+/g, ' ')
    .replaceAll(/^[\s.,;:!?«»"'()-]+|[\s.,;:!?«»"'()-]+$/g, '')
    .slice(0, MAX_SYMPTOM_LENGTH);
}

function displaySymptom(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '') return NO_SYMPTOM;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function minScore(data: ReferenceData | undefined): number {
  const raw = data?.settings['knowledge.minScore'];
  const parsed = typeof raw === 'string' ? Number(raw) : raw;
  return typeof parsed === 'number' && Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MIN_SCORE;
}

function categoryLabel(data: ReferenceData | undefined, category: string | null): string {
  if (category === null) return 'Без категории';
  const item = data?.dictionaries.find(
    (entry) => entry.dictionary === 'category' && entry.code === category,
  );
  return item?.label ?? category;
}

function hasArticleHit(knowledge: unknown): boolean | null {
  if (!Array.isArray(knowledge)) return null;
  return knowledge.some((hit) => asRecord(hit)['kind'] === 'article');
}

/** Разбор `analysis.completed`: есть ли статья, симптом и категория. */
export function analysisOf(payload: unknown): AnalysisInfo {
  const draft = asRecord(asRecord(payload)['draft']);
  const symptom = symptomOf((key) => draftField(draft, key));
  const category = draftField(draft, 'category');
  return {
    hasArticle: hasArticleHit(draft['knowledge']),
    symptom,
    category: category === '' ? null : category,
  };
}

interface AnalysisEntry {
  at: number;
  info: AnalysisInfo;
}

function latestAnalysis(events: readonly { type: string; at: string; ticketId?: string; payload: unknown }[]): Map<string, AnalysisEntry> {
  const map = new Map<string, AnalysisEntry>();
  for (const event of events) {
    if (event.type !== 'analysis.completed' || !event.ticketId) continue;
    const at = Date.parse(event.at);
    if (!Number.isFinite(at)) continue;
    const current = map.get(event.ticketId);
    if (current && current.at > at) continue;
    map.set(event.ticketId, { at, info: analysisOf(event.payload) });
  }
  return map;
}

function journalMisses(
  events: readonly { type: string; ticketId?: string; payload: unknown }[],
): Map<string, { symptom: string; category: string | null }> {
  const map = new Map<string, { symptom: string; category: string | null }>();
  for (const event of events) {
    if (event.type !== 'report-kb-gaps.miss' || !event.ticketId) continue;
    const payload = asRecord(event.payload);
    const symptom = valueText(payload['symptom']);
    const category = valueText(payload['category']);
    map.set(event.ticketId, { symptom, category: category === '' ? null : category });
  }
  return map;
}

/** Решение по заявке: разбор важнее журнала, журнал — важнее поиска по базе. */
async function resolveTicket(
  ticket: Ticket,
  fields: readonly TicketField[],
  analysis: AnalysisEntry | undefined,
  journal: { symptom: string; category: string | null } | undefined,
  db: KernelStore,
  cache: Map<string, boolean>,
  score: number,
): Promise<TicketResult> {
  const fallbackSymptom = symptomOf((key) => ticketField(fields, key));
  const symptom = analysis?.info.symptom || journal?.symptom || fallbackSymptom;
  const category = analysis?.info.category ?? journal?.category ?? ticket.category;
  const known = analysis?.info.hasArticle ?? null;

  if (known === true) return { hasArticle: true, source: 'analysis', symptom, category };
  if (known === false) {
    return { hasArticle: false, source: journal ? 'journal' : 'analysis', symptom, category };
  }
  if (journal) return { hasArticle: false, source: 'journal', symptom, category };

  const cacheKey = `${category ?? ''}|${normalize(symptom)}`;
  let hasArticle = cache.get(cacheKey);
  if (hasArticle === undefined) {
    const hits =
      symptom.trim() === ''
        ? []
        : await db.searchKnowledge({ text: symptom, category: category ?? undefined, limit: 1 });
    hasArticle = hits.some((hit) => (hit.score ?? 0) >= score);
    cache.set(cacheKey, hasArticle);
  }
  return { hasArticle, source: 'knowledge-base', symptom, category };
}

function themeKey(category: string | null, symptom: string): string {
  const normalized = normalize(symptom);
  return normalized === '' ? NO_SYMPTOM_KEY : `${category ?? 'none'}:${normalized}`;
}

function themesOf(
  results: readonly TicketResult[],
  tickets: readonly Ticket[],
  data: ReferenceData | undefined,
): { themes: KbGapsTheme[]; withoutArticle: number } {
  const withoutArticle = results.filter((item) => !item.hasArticle).length;
  const groups = new Map<string, ThemeAccumulator>();

  results.forEach((item, index) => {
    if (item.hasArticle) return;
    const symptom = displaySymptom(item.symptom);
    const key = themeKey(item.category, item.symptom);
    const ticket = tickets[index];
    const group = groups.get(key) ?? {
      key: `theme:${key}`,
      symptom,
      category: item.category,
      count: 0,
      exampleTicketId: ticket?.id ?? null,
      exampleNumber: ticket?.number ?? null,
    };
    group.count += 1;
    groups.set(key, group);
  });

  const themes = [...groups.values()]
    .sort((left, right) => right.count - left.count || left.symptom.localeCompare(right.symptom))
    .slice(0, THEME_LIMIT)
    .map((group) => ({
      key: group.key,
      label: group.symptom.slice(0, MAX_SYMPTOM_LENGTH),
      symptom: group.symptom,
      category: group.category,
      categoryLabel: categoryLabel(data, group.category),
      count: group.count,
      sharePercent: withoutArticle === 0 ? 0 : round((group.count / withoutArticle) * 100),
      exampleTicketId: group.exampleTicketId,
      exampleNumber: group.exampleNumber,
    }));

  return { themes, withoutArticle };
}

function categoryRows(
  results: readonly TicketResult[],
  data: ReferenceData | undefined,
): KbGapsCategoryRow[] {
  interface Accumulator {
    total: number;
    without: number;
    symptoms: Map<string, { label: string; count: number }>;
  }
  const groups = new Map<string, Accumulator>();
  for (const item of results) {
    const key = item.category ?? 'none';
    const group = groups.get(key) ?? { total: 0, without: 0, symptoms: new Map() };
    group.total += 1;
    if (!item.hasArticle) {
      group.without += 1;
      const symptom = displaySymptom(item.symptom);
      const current = group.symptoms.get(symptom) ?? { label: symptom, count: 0 };
      current.count += 1;
      group.symptoms.set(symptom, current);
    }
    groups.set(key, group);
  }

  return [...groups.entries()]
    .map(([key, group]) => {
      const category = key === 'none' ? null : key;
      const top = [...group.symptoms.values()].sort(
        (left, right) => right.count - left.count || left.label.localeCompare(right.label),
      )[0];
      return {
        category,
        label: categoryLabel(data, category),
        total: group.total,
        withoutArticle: group.without,
        sharePercent: percent(group.without, group.total),
        topSymptom: top?.label ?? null,
      };
    })
    .sort(
      (left, right) =>
        right.withoutArticle - left.withoutArticle ||
        right.total - left.total ||
        left.label.localeCompare(right.label),
    );
}

/** Считает О6: заявки без подходящей статьи, частые темы и разрезы по категориям. */
export async function computeKbGaps(
  params: KbGapsParams,
  deps: KbGapsDeps,
): Promise<KbGapsResult> {
  const period = periodOf(params, deps.clock.now());
  const from = Date.parse(period.from);
  const to = Date.parse(period.to);

  const tickets = (await deps.db.listTickets({ limit: MAX_TICKETS })).filter(
    (ticket) => ticket.status !== 'cancelled' && inPeriod(ticket, from, to),
  );
  const events = await deps.db.listEvents({ limit: MAX_EVENTS });
  const analysis = latestAnalysis(events);
  const journal = journalMisses(events);
  const score = minScore(deps.data);
  const cache = new Map<string, boolean>();

  const results: TicketResult[] = [];
  for (const ticket of tickets) {
    const fields = await deps.db.getTicketFields(ticket.id);
    results.push(
      await resolveTicket(
        ticket,
        fields,
        analysis.get(ticket.id),
        journal.get(ticket.id),
        deps.db,
        cache,
        score,
      ),
    );
  }

  const { themes, withoutArticle } = themesOf(results, tickets, deps.data);
  const total = results.length;
  const analyzed = results.filter((item) => item.source === 'analysis' || item.source === 'journal').length;
  const summary: KbGapsSummary = {
    total,
    analyzed,
    withArticle: total - withoutArticle,
    withoutArticle,
    shareWithoutArticlePercent: percent(withoutArticle, total),
    themes: themes.length,
    fromJournal: results.filter((item) => item.source === 'journal').length,
    fromKnowledgeBase: results.filter((item) => item.source === 'knowledge-base').length,
  };

  return {
    period,
    filters: {},
    summary,
    themes,
    byCategory: categoryRows(results, deps.data),
  };
}
