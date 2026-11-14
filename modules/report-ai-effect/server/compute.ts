import type { DomainEvent } from '@ugra/contracts';
import type { KernelStore, ReferenceData } from '@ugra/core';
import type {
  AiEffectComparison,
  AiEffectFieldRow,
  AiEffectParams,
  AiEffectPeriod,
  AiEffectResult,
  AiEffectTotals,
} from '../contracts';

/**
 * Расчёт О5 «Эффект ИИ». Источник — журнал событий:
 * `ticket.field.set` (ИИ предложил значение) и `ticket.field.corrected` (человек исправил).
 * Цифры считает код; сравнение с ручным режимом — только если такие замеры есть.
 */

export interface AiEffectDeps {
  db: KernelStore;
  data?: ReferenceData;
  clock: { now(): Date };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS = 30;
const MAX_EVENTS = 200_000;

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function parseTime(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function within(time: number | null, from: number, to: number): boolean {
  return time !== null && time >= from && time <= to;
}

function periodOf(params: AiEffectParams, now: Date): AiEffectPeriod {
  const days = params.days ?? DEFAULT_DAYS;
  const to = now.getTime();
  const from = to - days * DAY_MS;
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString(), days };
}

function addCount(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function fieldLabel(data: ReferenceData | undefined, key: string): string {
  const field = data?.fields.find((item) => item.key === key);
  return field?.label ?? key;
}

function fieldRows(
  data: ReferenceData | undefined,
  corrections: Map<string, number>,
  suggestions: Map<string, number>,
): AiEffectFieldRow[] {
  const keys = new Set<string>([...corrections.keys(), ...suggestions.keys()]);
  return [...keys]
    .map((key) => ({
      fieldKey: key,
      label: fieldLabel(data, key),
      corrections: corrections.get(key) ?? 0,
      suggestions: suggestions.get(key) ?? 0,
    }))
    .sort(
      (left, right) =>
        right.corrections - left.corrections ||
        right.suggestions - left.suggestions ||
        left.fieldKey.localeCompare(right.fieldKey),
    )
    .slice(0, 10);
}

interface Scan {
  totals: AiEffectTotals;
  comparison: AiEffectComparison;
}

function scanEvents(events: readonly DomainEvent[], period: AiEffectPeriod, data?: ReferenceData): Scan {
  const from = Date.parse(period.from);
  const to = Date.parse(period.to);
  const ticketsWithAi = new Set<string>();
  const correctionsByTicket = new Map<string, number>();
  const correctionsByField = new Map<string, number>();
  const suggestionsByField = new Map<string, number>();
  const firstSuggestion = new Map<string, number>();
  let fieldsSuggested = 0;
  let fieldsCorrected = 0;

  // Первый проход: подсказки. Первая подсказка запоминается по всей истории —
  // иначе время до подтверждения у заявки, начатой до периода, было бы неверным.
  for (const event of events) {
    if (event.type !== 'ticket.field.set' || !event.ticketId) continue;
    const at = parseTime(event.at);
    const current = firstSuggestion.get(event.ticketId);
    if (at !== null && (current === undefined || at < current)) firstSuggestion.set(event.ticketId, at);
    if (!within(at, from, to)) continue;
    fieldsSuggested += 1;
    ticketsWithAi.add(event.ticketId);
    const fieldKey = fieldKeyOf(event);
    if (fieldKey) addCount(suggestionsByField, fieldKey);
  }

  // Второй проход: правки — только по заявкам, где ИИ предлагал поля в этом периоде,
  // чтобы числитель и знаменатель доли считались по одному множеству заявок.
  for (const event of events) {
    if (event.type !== 'ticket.field.corrected' || !event.ticketId) continue;
    if (!ticketsWithAi.has(event.ticketId)) continue;
    const at = parseTime(event.at);
    if (!within(at, from, to)) continue;
    fieldsCorrected += 1;
    correctionsByTicket.set(event.ticketId, (correctionsByTicket.get(event.ticketId) ?? 0) + 1);
    const fieldKey = fieldKeyOf(event);
    if (fieldKey) addCount(correctionsByField, fieldKey);
  }

  // Второй проход: подтверждения — после того как известны все первые подсказки.
  let confirmSum = 0;
  let confirmCount = 0;
  for (const event of events) {
    if (event.type !== 'ticket.confirmed' || !event.ticketId) continue;
    const at = parseTime(event.at);
    if (!within(at, from, to) || at === null) continue;
    const started = firstSuggestion.get(event.ticketId);
    if (started === undefined) continue;
    confirmSum += Math.max(0, Math.round((at - started) / 60_000));
    confirmCount += 1;
  }

  let ticketsWithoutEdits = 0;
  for (const ticketId of ticketsWithAi) {
    if ((correctionsByTicket.get(ticketId) ?? 0) === 0) ticketsWithoutEdits += 1;
  }

  const avgMinutesToConfirm = confirmCount === 0 ? null : Math.round(confirmSum / confirmCount);
  const totals: AiEffectTotals = {
    ticketsWithAi: ticketsWithAi.size,
    fieldsSuggested,
    fieldsCorrected,
    ticketsWithoutEdits,
    shareWithoutEditsPercent:
      ticketsWithAi.size === 0 ? null : round((ticketsWithoutEdits / ticketsWithAi.size) * 100),
    avgCorrectionsPerTicket:
      ticketsWithAi.size === 0 ? null : round(fieldsCorrected / ticketsWithAi.size),
    avgMinutesToConfirm,
    confirmedTickets: confirmCount,
    correctionsByField: fieldRows(data, correctionsByField, suggestionsByField),
  };

  const comparison: AiEffectComparison =
    confirmCount === 0
      ? {
          withAi: { tickets: ticketsWithAi.size, avgMinutesToConfirm: null },
          withoutAi: null,
          source: 'none',
          note: 'Подтверждений за период нет — сравнение с ручным режимом показать нечем.',
        }
      : {
          withAi: { tickets: ticketsWithAi.size, avgMinutesToConfirm },
          withoutAi: null,
          source: 'none',
          note: 'Замеров ручного режима ещё нет: данные «без ИИ» не подставляем и не выдумываем.',
        };

  return { totals, comparison };
}

function fieldKeyOf(event: DomainEvent): string | null {
  if (typeof event.payload !== 'object' || event.payload === null) return null;
  const payload = event.payload as { fieldKey?: unknown };
  return typeof payload.fieldKey === 'string' && payload.fieldKey !== '' ? payload.fieldKey : null;
}

/** Считает О5 по журналу событий за период. */
export async function computeAiEffect(
  params: AiEffectParams,
  deps: AiEffectDeps,
): Promise<AiEffectResult> {
  const period = periodOf(params, deps.clock.now());
  const events = await deps.db.listEvents({ limit: MAX_EVENTS });
  const scan = scanEvents(events, period, deps.data);
  return { period, totals: scan.totals, comparison: scan.comparison };
}
