import { readFileSync } from 'node:fs';
import type { PriorityLevel, Ticket, TicketStatus } from '@ugra/contracts';
import type { KernelStore, ReferenceData } from '@ugra/core';
import type {
  Heatmap,
  HotSpot,
  OverdueGroup,
  OverdueItem,
  OverdueResult,
  OverviewAiEffect,
  OverviewDeltas,
  OverviewInsights,
  OverviewParams,
  OverviewPeriod,
  OverviewPrioritySlice,
  OverviewResult,
  OverviewSlice,
  OverviewTotals,
} from '../contracts';

/**
 * Расчёт отчёта О0 «Дашборд». Цифры считает только код; тексты «что это значит» —
 * шаблоны по фактам (ИИ-вывод подключается агентом `analyst`, когда он появится).
 */

export interface OverviewDeps {
  db: KernelStore;
  data?: ReferenceData;
  clock: { now(): Date };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS = 30;
const MAX_TICKETS = 100_000;
const MAX_EVENTS = 100_000;

const PRIORITY_ORDER: readonly PriorityLevel[] = [
  'emergency',
  'critical',
  'high',
  'medium',
  'low',
];

const PRIORITY_FALLBACK: Record<PriorityLevel, string> = {
  emergency: 'Авария',
  critical: 'Критический',
  high: 'Высокий',
  medium: 'Средний',
  low: 'Низкий',
};

const STATUS_FALLBACK: Record<TicketStatus, string> = {
  new: 'Новая',
  ai_draft: 'Черновик ИИ',
  waiting_applicant: 'Ждёт заявителя',
  in_review: 'На проверке',
  assigned: 'Назначена',
  in_progress: 'В работе',
  resolved: 'Решена',
  closed: 'Закрыта',
  cancelled: 'Отменена',
};

const OPEN_STATUSES: readonly TicketStatus[] = [
  'new',
  'ai_draft',
  'waiting_applicant',
  'in_review',
  'assigned',
  'in_progress',
];

const BUILDING_BY_CODE: Record<string, string> = {
  a: 'А',
  b: 'Б',
  v: 'В',
  prom: 'ПРОМ',
};

const HEATMAP_DAYS: readonly { weekday: number; label: string }[] = [
  { weekday: 1, label: 'Пн' },
  { weekday: 2, label: 'Вт' },
  { weekday: 3, label: 'Ср' },
  { weekday: 4, label: 'Чт' },
  { weekday: 5, label: 'Пт' },
];

const HEATMAP_HOURS: readonly number[] = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17];

interface ResolvedAt {
  at: string;
  minutes: number | null;
}

interface PeriodTotals {
  totals: OverviewTotals;
  avgResolutionMinutes: number | null;
  resolvedTickets: Ticket[];
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function percent(part: number, total: number): number {
  return total === 0 ? 0 : round((part / total) * 100);
}

function parseTime(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isOpen(status: TicketStatus): boolean {
  return OPEN_STATUSES.includes(status);
}

/** Корпус и кабинет из `locationId` вида `cab-b-312`. */
export function parseLocation(locationId: string | null): { code: string; cabinet: string } | null {
  if (!locationId) return null;
  const match = /^cab-([a-z]+)-(.+)$/.exec(locationId);
  if (!match) return null;
  const code = match[1];
  const cabinet = match[2];
  if (!code || !cabinet) return null;
  return { code, cabinet };
}

function buildingCode(building: string | null): string | null {
  if (!building) return null;
  const parsed = parseLocation(building);
  return parsed ? parsed.code : null;
}

function labelOf(
  data: ReferenceData | undefined,
  dictionary: string,
  code: string,
  fallback?: string,
): string {
  const item = data?.dictionaries.find(
    (entry) => entry.dictionary === dictionary && entry.code === code,
  );
  return item?.label ?? fallback ?? code;
}

let engineerNames: Map<string, string> | null = null;

/** Имена исполнителей: в ссылочных данных их нет, читаем один раз из `data/engineers.json`. */
function engineerName(id: string): string {
  if (!engineerNames) {
    engineerNames = new Map();
    try {
      const url = new URL('../../../data/engineers.json', import.meta.url);
      const parsed = JSON.parse(readFileSync(url, 'utf8')) as {
        engineers?: { id?: unknown; fullName?: unknown }[];
      };
      for (const engineer of parsed.engineers ?? []) {
        if (typeof engineer.id === 'string' && typeof engineer.fullName === 'string') {
          engineerNames.set(engineer.id, engineer.fullName);
        }
      }
    } catch {
      // Без справочника показываем id: отчёт не должен падать из-за имён.
    }
  }
  return engineerNames.get(id) ?? id;
}

function periodDays(params: OverviewParams, now: Date): OverviewPeriod {
  const to = parseTime(params.to) ?? now.getTime();
  const from = parseTime(params.from);
  const days = Math.max(
    1,
    Math.round((to - (from ?? to - (params.days ?? DEFAULT_DAYS) * DAY_MS)) / DAY_MS),
  );
  const fromTime = from ?? to - days * DAY_MS;
  return {
    from: new Date(fromTime).toISOString(),
    to: new Date(to).toISOString(),
    days: Math.max(1, Math.round((to - fromTime) / DAY_MS)),
  };
}

function previousPeriod(period: OverviewPeriod): { from: number; to: number; period: OverviewPeriod } {
  const from = Date.parse(period.from);
  const to = from - 1;
  const previousFrom = from - period.days * DAY_MS;
  return {
    from: previousFrom,
    to,
    period: {
      from: new Date(previousFrom).toISOString(),
      to: new Date(to).toISOString(),
      days: period.days,
    },
  };
}

function resolutionsOf(events: readonly { type: string; at: string; ticketId?: string; payload: unknown }[]): Map<string, ResolvedAt> {
  const resolutions = new Map<string, ResolvedAt>();
  for (const event of events) {
    if (event.type !== 'ticket.status.changed' || !event.ticketId) continue;
    if (typeof event.payload !== 'object' || event.payload === null) continue;
    const payload = event.payload as { to?: unknown; resolvedAt?: unknown; resolutionMinutes?: unknown };
    if (payload.to !== 'closed' && payload.to !== 'resolved') continue;
    resolutions.set(event.ticketId, {
      at: typeof payload.resolvedAt === 'string' ? payload.resolvedAt : event.at,
      minutes: typeof payload.resolutionMinutes === 'number' ? payload.resolutionMinutes : null,
    });
  }
  return resolutions;
}

function resolutionOf(ticket: Ticket, resolutions: Map<string, ResolvedAt>): ResolvedAt | null {
  const created = Date.parse(ticket.createdAt);
  const known = resolutions.get(ticket.id);
  if (known) {
    const at = Date.parse(known.at);
    return {
      at: known.at,
      minutes:
        known.minutes ?? (Number.isFinite(at) ? Math.max(0, Math.round((at - created) / 60_000)) : null),
    };
  }
  if (ticket.status === 'closed' || ticket.status === 'resolved') {
    const at = Date.parse(ticket.updatedAt);
    return {
      at: ticket.updatedAt,
      minutes: Number.isFinite(at) ? Math.max(0, Math.round((at - created) / 60_000)) : null,
    };
  }
  return null;
}

function matchesFilters(
  ticket: Ticket,
  params: OverviewParams,
  channels: Map<string, string>,
): boolean {
  if (params.category && ticket.category !== params.category) return false;
  if (params.assigneeId && ticket.assigneeId !== params.assigneeId) return false;
  if (params.status && ticket.status !== params.status) return false;
  if (params.building) {
    const location = parseLocation(ticket.locationId);
    if (!location || BUILDING_BY_CODE[location.code] !== params.building) return false;
  }
  if (params.channel && channels.get(ticket.id) !== params.channel) return false;
  return true;
}

function ticketsIn(
  tickets: readonly Ticket[],
  from: number,
  to: number,
  params: OverviewParams,
  channels: Map<string, string>,
): Ticket[] {
  return tickets.filter((ticket) => {
    const created = Date.parse(ticket.createdAt);
    return created >= from && created <= to && matchesFilters(ticket, params, channels);
  });
}

function collectTotals(
  tickets: readonly Ticket[],
  resolutions: Map<string, ResolvedAt>,
  nowMs: number,
): PeriodTotals {
  let open = 0;
  let closed = 0;
  let cancelled = 0;
  let emergency = 0;
  let slaBreaches = 0;
  let dueClosed = 0;
  let closedBreaches = 0;
  let resolutionSum = 0;
  let resolutionCount = 0;
  const resolvedTickets: Ticket[] = [];

  for (const ticket of tickets) {
    if (ticket.isEmergency) emergency += 1;
    const resolution = resolutionOf(ticket, resolutions);
    const due = parseTime(ticket.slaDueAt ?? undefined);

    if (ticket.status === 'cancelled') {
      cancelled += 1;
      continue;
    }
    if (isOpen(ticket.status)) {
      open += 1;
      if (due !== null && nowMs > due) slaBreaches += 1;
      continue;
    }

    closed += 1;
    resolvedTickets.push(ticket);
    if (resolution?.minutes !== null && resolution?.minutes !== undefined) {
      resolutionSum += resolution.minutes;
      resolutionCount += 1;
    }
    if (due !== null) {
      dueClosed += 1;
      const resolvedAt = resolution ? Date.parse(resolution.at) : Number.NaN;
      if (Number.isFinite(resolvedAt) && resolvedAt > due) {
        slaBreaches += 1;
        closedBreaches += 1;
      }
    }
  }

  return {
    totals: {
      total: tickets.length,
      open,
      closed,
      cancelled,
      emergency,
      slaBreaches,
      slaOnTimePercent: dueClosed > 0 ? round(((dueClosed - closedBreaches) / dueClosed) * 100) : null,
    },
    avgResolutionMinutes: resolutionCount > 0 ? Math.round(resolutionSum / resolutionCount) : null,
    resolvedTickets,
  };
}

function countBy<T>(items: readonly T[], keyOf: (item: T) => string | null): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyOf(item);
    if (key === null) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function toSlices(
  counts: Map<string, number>,
  label: (key: string) => string,
  order?: readonly string[],
): OverviewSlice[] {
  const keys = order ? [...order] : [...counts.keys()];
  const slices = keys.map((key) => ({
    key,
    label: label(key),
    count: counts.get(key) ?? 0,
  }));
  if (!order) slices.sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
  return slices;
}

/** Сколько обращений каждого приоритета пришло в каждый день периода — мини-столбцы. */
function dailyByPriority(
  tickets: readonly Ticket[],
  period: OverviewPeriod,
): Map<string, number[]> {
  const daily = new Map<string, number[]>(
    PRIORITY_ORDER.map((key) => [key, new Array<number>(period.days).fill(0)]),
  );
  const from = Date.parse(period.from);
  for (const ticket of tickets) {
    const row = ticket.priority ? daily.get(ticket.priority) : undefined;
    if (!row) continue;
    const index = Math.floor((Date.parse(ticket.createdAt) - from) / DAY_MS);
    if (index < 0 || index >= period.days) continue;
    row[index] = (row[index] ?? 0) + 1;
  }
  return daily;
}

/** Эффект ИИ: заявки периода, в которых диспетчер правил поля после разбора. */
function aiEffectOf(
  tickets: readonly Ticket[],
  corrections: readonly { at?: string; ticketId?: string }[],
  period: OverviewPeriod,
): OverviewAiEffect {
  const from = Date.parse(period.from);
  const to = Date.parse(period.to);
  const ids = new Set(tickets.map((ticket) => ticket.id));
  const corrected = new Set<string>();
  for (const event of corrections) {
    if (!event.ticketId || !ids.has(event.ticketId)) continue;
    const at = event.at ? Date.parse(event.at) : Number.NaN;
    if (Number.isNaN(at) || at < from || at > to) continue;
    corrected.add(event.ticketId);
  }
  const total = tickets.length;
  return {
    correctedTickets: corrected.size,
    totalTickets: total,
    withoutEditsPercent:
      total === 0 ? null : Math.round((1 - corrected.size / total) * 1000) / 10,
  };
}

function heatmapOf(tickets: readonly Ticket[]): Heatmap {
  const counts = new Map<string, number>();
  for (const ticket of tickets) {
    const created = new Date(ticket.createdAt);
    const weekday = created.getDay();
    const hour = created.getHours();
    if (!HEATMAP_DAYS.some((day) => day.weekday === weekday)) continue;
    if (!HEATMAP_HOURS.includes(hour)) continue;
    const key = `${weekday}:${hour}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let max = 0;
  for (const count of counts.values()) max = Math.max(max, count);
  return {
    days: HEATMAP_DAYS.map((day) => ({
      day: day.label,
      cells: HEATMAP_HOURS.map((hour) => ({
        hour,
        count: counts.get(`${day.weekday}:${hour}`) ?? 0,
      })),
    })),
    hours: [...HEATMAP_HOURS],
    max,
  };
}

function hotSpotsOf(
  tickets: readonly Ticket[],
  data: ReferenceData | undefined,
): HotSpot[] {
  const counts = new Map<string, { code: string; cabinet: string; count: number }>();
  for (const ticket of tickets) {
    const location = parseLocation(ticket.locationId);
    if (!location) continue;
    const key = `${location.code}:${location.cabinet}`;
    const current = counts.get(key);
    if (current) {
      current.count += 1;
    } else {
      counts.set(key, { code: location.code, cabinet: location.cabinet, count: 1 });
    }
  }
  const sorted = [...counts.values()].sort(
    (left, right) => right.count - left.count || left.code.localeCompare(right.code),
  );
  return sorted.slice(0, 5).map((item) => {
    const building = BUILDING_BY_CODE[item.code] ?? item.code;
    const buildingLabel = labelOf(data, 'building', building);
    return {
      building,
      cabinet: item.cabinet,
      label: `${buildingLabel} · каб. ${item.cabinet}`,
      count: item.count,
      sharePercent: percent(item.count, tickets.length),
    };
  });
}

function formatMinutes(minutes: number | null): string {
  if (minutes === null) return 'нет данных';
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} ч` : `${hours} ч ${rest} мин`;
}

function buildInsights(
  totals: OverviewTotals,
  previous: OverviewTotals,
  avg: number | null,
  byPriority: readonly OverviewSlice[],
  heatmap: Heatmap,
  hotSpots: readonly HotSpot[],
): OverviewInsights {
  const change = previous.total === 0 ? null : round(((totals.total - previous.total) / previous.total) * 100);
  const changeText =
    change === null
      ? ''
      : change === 0
        ? ', как и в прошлом периоде'
        : `, на ${Math.abs(change)}% ${change > 0 ? 'больше' : 'меньше'} прошлого периода`;
  const summary = `За период ${totals.total} обращений${changeText}. Аварий — ${totals.emergency}, среднее время решения — ${formatMinutes(avg)}.`;

  const heavy = byPriority
    .filter((slice) => slice.key === 'emergency' || slice.key === 'critical')
    .reduce((sum, slice) => sum + slice.count, 0);
  const heavyShare = percent(heavy, totals.total);
  const top = byPriority.reduce<OverviewSlice | null>(
    (best, slice) => (best === null || slice.count > best.count ? slice : best),
    null,
  );
  const priorities =
    totals.total === 0
      ? 'Обращений за период нет — разрез пуст.'
      : heavyShare >= 20
        ? `Тяжёлых заявок (авария и критический) ${heavyShare}% — ${heavy} из ${totals.total}. Это выше спокойного уровня: проверьте, не тянется ли одна причина.`
        : `Основная нагрузка — «${top?.label ?? 'нет данных'}»: ${top?.count ?? 0} обращений, ${percent(top?.count ?? 0, totals.total)}% от всех. Тяжёлых заявок ${heavyShare}%.`;

  const flat = heatmap.days.flatMap((row) => row.cells.map((cell) => ({ day: row.day, ...cell })));
  const peak = flat.reduce(
    (best, cell) => (cell.count > best.count ? cell : best),
    { day: '—', hour: 0, count: 0 },
  );
  const averageCell = flat.length > 0 ? flat.reduce((sum, cell) => sum + cell.count, 0) / flat.length : 0;
  const ratio = averageCell > 0 ? round(peak.count / averageCell) : 0;
  const heatmapText =
    peak.count === 0
      ? 'За период нет обращений в рабочие часы — карта пуста.'
      : `Пик — ${peak.day} ${peak.hour}:00, ${peak.count} обращений в час${ratio >= 1.5 ? `, в ${ratio} раза больше среднего` : ''}. Что сделать: усилить дежурство в это окно.`;

  const slaText =
    totals.slaOnTimePercent === null
      ? 'Закрытых заявок со сроком SLA за период нет.'
      : `В срок закрыто ${totals.slaOnTimePercent}% заявок, нарушений — ${totals.slaBreaches}${totals.slaOnTimePercent < 90 ? '. Что сделать: разобрать просроченные заявки и продлить срок там, где он нереалистичен.' : '.'}`;

  const leader = hotSpots[0];
  const hotspots =
    !leader || leader.count === 0
      ? {
          meaning: 'Повторных обращений по одному месту за период не было.',
          action: null,
        }
      : {
          meaning: `«${leader.label}» — ${leader.count} обращений (${leader.sharePercent}% от всех). Повторения в одном кабинете обычно означают неисправную технику или ошибку настройки, а не разовые сбои.`,
          action:
            leader.count >= 3
              ? `Проверить оборудование: ${leader.label}. Если ремонт повторяется — заменить аппарат или расходники, это дешевле повторных выездов.`
              : 'Держать на контроле: одно повторное обращение — ещё не тенденция.',
        };

  return { summary, priorities, heatmap: heatmapText, sla: slaText, hotspots };
}

function deltaOf(
  totals: OverviewTotals,
  previous: OverviewTotals,
  avg: number | null,
  previousAvg: number | null,
): OverviewDeltas {
  return {
    total:
      previous.total === 0
        ? null
        : round(((totals.total - previous.total) / previous.total) * 100),
    open: totals.open - previous.open,
    emergency: totals.emergency - previous.emergency,
    slaOnTime:
      totals.slaOnTimePercent === null || previous.slaOnTimePercent === null
        ? null
        : round(totals.slaOnTimePercent - previous.slaOnTimePercent),
    avgResolutionMinutes:
      avg === null || previousAvg === null ? null : avg - previousAvg,
  };
}

/** Короткая тема заявки для списка: симптом, объект или категория. */
async function titleOf(ticket: Ticket, db: KernelStore): Promise<string> {
  const fields = await db.getTicketFields(ticket.id);
  const value = (key: string): string | null => {
    const found = fields.find((field) => field.fieldKey === key);
    return found && found.value !== null ? String(found.value) : null;
  };
  const text = value('symptoms') ?? value('object') ?? value('category') ?? 'Обращение';
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}

/** Просроченные заявки периода — список и группы по исполнителям для шторки дашборда. */
export async function computeOverdue(
  params: OverviewParams,
  deps: OverviewDeps,
): Promise<OverdueResult> {
  const now = deps.clock.now();
  const period = periodDays(params, now);
  const allTickets = await deps.db.listTickets({ limit: MAX_TICKETS });
  const channels = new Map<string, string>();
  if (params.channel) {
    for (const ticket of allTickets) {
      const appeal = await deps.db.getAppeal(ticket.appealId);
      if (appeal) channels.set(ticket.id, appeal.channel);
    }
  }
  const tickets = ticketsIn(allTickets, Date.parse(period.from), Date.parse(period.to), params, channels);
  const items: OverdueItem[] = [];
  for (const ticket of tickets) {
    if (!OPEN_STATUSES.includes(ticket.status)) continue;
    if (!ticket.slaDueAt) continue;
    const due = Date.parse(ticket.slaDueAt);
    if (Number.isNaN(due) || due >= now.getTime()) continue;
    items.push({
      ticketId: ticket.id,
      number: ticket.number,
      title: await titleOf(ticket, deps.db),
      assigneeId: ticket.assigneeId,
      assigneeName: ticket.assigneeId ? engineerName(ticket.assigneeId) : null,
      overdueMinutes: Math.round((now.getTime() - due) / 60_000),
    });
  }
  items.sort((left, right) => right.overdueMinutes - left.overdueMinutes);

  const groupsByKey = new Map<string | null, OverdueGroup>();
  for (const item of items) {
    const key = item.assigneeId;
    const group = groupsByKey.get(key) ?? {
      assigneeId: key,
      assigneeName: item.assigneeName ?? 'Без исполнителя',
      count: 0,
    };
    group.count += 1;
    groupsByKey.set(key, group);
  }
  return {
    total: items.length,
    items,
    groups: [...groupsByKey.values()].sort((left, right) => right.count - left.count),
  };
}

/** Считает отчёт О0 по заявкам, событиям и ссылочным данным. */
export async function computeOverview(
  params: OverviewParams,
  deps: OverviewDeps,
): Promise<OverviewResult> {
  const now = deps.clock.now();
  const period = periodDays(params, now);
  const previous = previousPeriod(period);
  const from = Date.parse(period.from);
  const to = Date.parse(period.to);

  const allTickets = await deps.db.listTickets({ limit: MAX_TICKETS });
  const resolutions = resolutionsOf(await deps.db.listEvents({ limit: MAX_EVENTS }));

  const channels = new Map<string, string>();
  if (params.channel) {
    for (const ticket of allTickets) {
      const appeal = await deps.db.getAppeal(ticket.appealId);
      if (appeal) channels.set(ticket.id, appeal.channel);
    }
  }

  const currentTickets = ticketsIn(allTickets, from, to, params, channels);
  const previousTickets = ticketsIn(allTickets, previous.from, previous.to, params, channels);
  const current = collectTotals(currentTickets, resolutions, now.getTime());
  const previousTotals = collectTotals(previousTickets, resolutions, now.getTime());

  const priorityDaily = dailyByPriority(currentTickets, period);
  const byPriority: OverviewPrioritySlice[] = toSlices(
    countBy(currentTickets, (ticket) => ticket.priority),
    (key) => labelOf(deps.data, 'priority', key, PRIORITY_FALLBACK[key as PriorityLevel]),
    PRIORITY_ORDER,
  ).map((slice) => ({
    ...slice,
    daily: priorityDaily.get(slice.key) ?? new Array<number>(period.days).fill(0),
  }));
  const byCategory = toSlices(
    countBy(currentTickets, (ticket) => ticket.category),
    (key) => labelOf(deps.data, 'category', key),
  );
  const byBuilding = toSlices(
    countBy(currentTickets, (ticket) => {
      const code = buildingCode(ticket.locationId);
      return code ? BUILDING_BY_CODE[code] ?? code : null;
    }),
    (key) => labelOf(deps.data, 'building', key),
  );
  const byAssignee = toSlices(
    countBy(currentTickets, (ticket) => ticket.assigneeId),
    (key) => engineerName(key),
  );
  const byStatus = toSlices(
    countBy(currentTickets, (ticket) => ticket.status),
    (key) => STATUS_FALLBACK[key as TicketStatus] ?? key,
  );

  const heatmap = heatmapOf(currentTickets);
  const hotSpots = hotSpotsOf(currentTickets, deps.data);
  const corrections = await deps.db.listEvents({ type: 'ticket.field.corrected', limit: MAX_EVENTS });
  const aiEffect = aiEffectOf(currentTickets, corrections, period);
  const slaTarget = deps.data?.settings?.['slaTargetPercent'];

  return {
    period,
    previousPeriod: previous.period,
    filters: {
      ...(params.category ? { category: params.category } : {}),
      ...(params.assigneeId ? { assigneeId: params.assigneeId } : {}),
      ...(params.channel ? { channel: params.channel } : {}),
      ...(params.building ? { building: params.building } : {}),
      ...(params.status ? { status: params.status } : {}),
    },
    totals: current.totals,
    previousTotals: previousTotals.totals,
    deltas: deltaOf(current.totals, previousTotals.totals, current.avgResolutionMinutes, previousTotals.avgResolutionMinutes),
    avgResolutionMinutes: current.avgResolutionMinutes,
    previousAvgResolutionMinutes: previousTotals.avgResolutionMinutes,
    byPriority,
    slaTargetPercent: typeof slaTarget === 'number' ? slaTarget : null,
    aiEffect,
    byCategory,
    byBuilding,
    byAssignee,
    byStatus,
    heatmap,
    hotSpots,
    insights: buildInsights(
      current.totals,
      previousTotals.totals,
      current.avgResolutionMinutes,
      byPriority,
      heatmap,
      hotSpots,
    ),
  };
}
