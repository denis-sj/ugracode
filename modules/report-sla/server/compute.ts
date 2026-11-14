import { readFileSync } from 'node:fs';
import type { PriorityLevel, Ticket, TicketStatus } from '@ugra/contracts';
import type { KernelStore, ReferenceData } from '@ugra/core';
import type {
  SlaDepartmentRow,
  SlaParams,
  SlaPeriod,
  SlaPriorityRow,
  SlaResult,
  SlaSummary,
  SlaTicketRef,
} from '../contracts';

/**
 * Расчёт О3 «Сроки (SLA)». Цифры считает только код.
 *
 * Срок решения — `ticket.slaDueAt`, фактическое решение — событие `ticket.status.changed`
 * (`resolved` / `closed`), иначе `updatedAt` закрытой заявки. Срок реакции — `ticket.reactDueAt`,
 * фактическая реакция — `ticket.confirmedAt` или первое событие назначения/взятия в работу
 * (`ticket.assigned`, переход в `assigned` / `in_progress`). Заявки из истории без таких событий
 * честно попадают в «реакция неизвестна», а не получают выдуманное время.
 */

export interface SlaDeps {
  db: KernelStore;
  data?: ReferenceData;
  clock: { now(): Date };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS = 30;
const MAX_TICKETS = 100_000;
const MAX_EVENTS = 100_000;
const WORST_LIMIT = 5;
const AT_RISK_MS = DAY_MS;

const OPEN_STATUSES: readonly TicketStatus[] = [
  'new',
  'ai_draft',
  'waiting_applicant',
  'in_review',
  'assigned',
  'in_progress',
];

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

interface Resolution {
  at: number;
  minutes: number;
}

interface Counters {
  total: number;
  closed: number;
  open: number;
  dueKnown: number;
  onTimeClosed: number;
  lateClosed: number;
  openOverdue: number;
  resolutionSum: number;
  resolutionCount: number;
  lateSum: number;
  lateCount: number;
}

interface PeriodEvent {
  type: string;
  at: string;
  ticketId?: string;
  payload: unknown;
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function percent(part: number, total: number): number | null {
  return total === 0 ? null : round((part / total) * 100);
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isOpen(status: TicketStatus): boolean {
  return OPEN_STATUSES.includes(status);
}

function isClosed(status: TicketStatus): boolean {
  return status === 'closed' || status === 'resolved';
}

function periodOf(params: SlaParams, now: Date): SlaPeriod {
  const days = params.days ?? DEFAULT_DAYS;
  const to = now.getTime();
  return { from: new Date(to - days * DAY_MS).toISOString(), to: new Date(to).toISOString(), days };
}

function inPeriod(ticket: Ticket, from: number, to: number): boolean {
  const created = parseTime(ticket.createdAt);
  return created !== null && created >= from && created <= to;
}

function matchesFilters(ticket: Ticket, params: SlaParams): boolean {
  if (params.priority && ticket.priority !== params.priority) return false;
  if (params.assigneeId && ticket.assigneeId !== params.assigneeId) return false;
  return true;
}

function resolutionsOf(events: readonly PeriodEvent[]): Map<string, Resolution> {
  const map = new Map<string, Resolution>();
  for (const event of events) {
    if (event.type !== 'ticket.status.changed' || !event.ticketId) continue;
    if (typeof event.payload !== 'object' || event.payload === null) continue;
    const payload = event.payload as { to?: unknown; resolvedAt?: unknown; resolutionMinutes?: unknown };
    if (payload.to !== 'closed' && payload.to !== 'resolved') continue;
    const at = typeof payload.resolvedAt === 'string' ? Date.parse(payload.resolvedAt) : Date.parse(event.at);
    if (!Number.isFinite(at)) continue;
    map.set(event.ticketId, {
      at,
      minutes:
        typeof payload.resolutionMinutes === 'number'
          ? Math.max(0, Math.round(payload.resolutionMinutes))
          : 0,
    });
  }
  return map;
}

/** Первое событие «человек взял заявку»: назначение или переход в работу. */
function reactionTimesOf(events: readonly PeriodEvent[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const event of events) {
    if (!event.ticketId) continue;
    const reaction = reactionEventAt(event);
    if (reaction === null) continue;
    const current = map.get(event.ticketId);
    if (current === undefined || reaction < current) map.set(event.ticketId, reaction);
  }
  return map;
}

function reactionEventAt(event: PeriodEvent): number | null {
  const at = parseTime(event.at);
  if (at === null) return null;
  if (event.type === 'ticket.assigned') return at;
  if (event.type !== 'ticket.status.changed') return null;
  if (typeof event.payload !== 'object' || event.payload === null) return null;
  const payload = event.payload as { to?: unknown };
  return payload.to === 'assigned' || payload.to === 'in_progress' ? at : null;
}

function resolutionOf(ticket: Ticket, resolutions: Map<string, Resolution>): Resolution | null {
  const known = resolutions.get(ticket.id);
  const created = parseTime(ticket.createdAt);
  if (known) {
    return {
      at: known.at,
      minutes:
        known.minutes > 0
          ? known.minutes
          : created === null
            ? 0
            : Math.max(0, Math.round((known.at - created) / 60_000)),
    };
  }
  if (!isClosed(ticket.status)) return null;
  const updated = parseTime(ticket.updatedAt);
  if (created === null || updated === null) return null;
  return { at: updated, minutes: Math.max(0, Math.round((updated - created) / 60_000)) };
}

function reactionOf(ticket: Ticket, reactions: Map<string, number>): number | null {
  const candidates: number[] = [];
  const confirmed = parseTime(ticket.confirmedAt);
  if (confirmed !== null) candidates.push(confirmed);
  const assigned = reactions.get(ticket.id);
  if (assigned !== undefined) candidates.push(assigned);
  if (candidates.length === 0) return null;
  const created = parseTime(ticket.createdAt);
  const at = Math.min(...candidates);
  if (created === null) return null;
  return Math.max(0, Math.round((at - created) / 60_000));
}

let engineerNames: Map<string, string> | null = null;

function readEngineerNames(data: ReferenceData | undefined): Map<string, string> {
  const extra = data?.extra['engineers'];
  if (Array.isArray(extra)) {
    const map = new Map<string, string>();
    for (const item of extra) {
      if (
        typeof item === 'object' &&
        item !== null &&
        typeof (item as { id?: unknown }).id === 'string' &&
        typeof (item as { fullName?: unknown }).fullName === 'string'
      ) {
        map.set((item as { id: string }).id, (item as { fullName: string }).fullName);
      }
    }
    if (map.size > 0) return map;
  }
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
  return engineerNames;
}

function engineerName(names: Map<string, string>, id: string | null): string {
  if (id === null) return 'Не назначено';
  return names.get(id) ?? id;
}

function departmentLabel(data: ReferenceData | undefined, id: string | null): string {
  if (id === null) return 'Без подразделения';
  const item = data?.dictionaries.find(
    (entry) => entry.dictionary === 'department' && entry.code === id,
  );
  return item?.label ?? id;
}

function priorityLabel(priority: PriorityLevel | null): string {
  return priority === null ? 'Без приоритета' : PRIORITY_FALLBACK[priority];
}

function emptyCounters(): Counters {
  return {
    total: 0,
    closed: 0,
    open: 0,
    dueKnown: 0,
    onTimeClosed: 0,
    lateClosed: 0,
    openOverdue: 0,
    resolutionSum: 0,
    resolutionCount: 0,
    lateSum: 0,
    lateCount: 0,
  };
}

function addResolution(counters: Counters, minutes: number | null): void {
  if (minutes === null) return;
  counters.resolutionSum += minutes;
  counters.resolutionCount += 1;
}

function avg(sum: number, count: number): number | null {
  return count === 0 ? null : Math.round(sum / count);
}

function priorityKey(ticket: Ticket): string {
  return ticket.priority ?? 'none';
}

function departmentKey(ticket: Ticket): string {
  return ticket.departmentId ?? 'none';
}

function worstRef(
  ticket: Ticket,
  lateMinutes: number,
  state: SlaTicketRef['state'],
  due: number,
  names: Map<string, string>,
): SlaTicketRef {
  return {
    id: ticket.id,
    number: ticket.number,
    priority: ticket.priority,
    status: ticket.status,
    assigneeId: ticket.assigneeId,
    assigneeName: engineerName(names, ticket.assigneeId),
    departmentId: ticket.departmentId,
    dueAt: new Date(due).toISOString(),
    lateMinutes,
    state,
  };
}

interface Totals {
  summary: SlaSummary;
  worst: SlaTicketRef[];
}

function collectTotals(
  tickets: readonly Ticket[],
  resolutions: Map<string, Resolution>,
  reactions: Map<string, number>,
  now: number,
  names: Map<string, string>,
  byPriority: Map<string, Counters>,
  byDepartment: Map<string, Counters>,
): Totals {
  const base = emptyCounters();
  const worst: SlaTicketRef[] = [];
  let cancelled = 0;
  let atRisk = 0;
  let reactionKnown = 0;
  let reactionMeasured = 0;
  let reactionOnTime = 0;
  let reactionBreaches = 0;
  let reactionSum = 0;

  for (const ticket of tickets) {
    if (ticket.status === 'cancelled') {
      cancelled += 1;
      continue;
    }
    const priority = byPriority.get(priorityKey(ticket)) ?? emptyCounters();
    const department = byDepartment.get(departmentKey(ticket)) ?? emptyCounters();
    const buckets = [base, priority, department];
    for (const bucket of buckets) bucket.total += 1;

    const due = parseTime(ticket.slaDueAt);
    const created = parseTime(ticket.createdAt);
    if (isOpen(ticket.status)) {
      for (const bucket of buckets) bucket.open += 1;
      if (due !== null) {
        const lateMinutes = Math.round((now - due) / 60_000);
        if (lateMinutes > 0) {
          for (const bucket of buckets) bucket.openOverdue += 1;
          worst.push(worstRef(ticket, lateMinutes, 'overdue-open', due, names));
        } else if (due - now <= AT_RISK_MS) {
          atRisk += 1;
        }
      }
    } else {
      const resolution = resolutionOf(ticket, resolutions);
      const minutes = resolution?.minutes ?? null;
      const lateMinutes =
        due !== null && resolution !== null && resolution.at > due
          ? Math.max(1, Math.round((resolution.at - due) / 60_000))
          : null;
      for (const bucket of buckets) {
        bucket.closed += 1;
        addResolution(bucket, minutes);
        if (due !== null && resolution !== null) {
          bucket.dueKnown += 1;
          if (lateMinutes === null) {
            bucket.onTimeClosed += 1;
          } else {
            bucket.lateClosed += 1;
            bucket.lateSum += lateMinutes;
            bucket.lateCount += 1;
          }
        }
      }
      if (lateMinutes !== null && due !== null) {
        worst.push(worstRef(ticket, lateMinutes, 'late-closed', due, names));
      }
    }

    const reaction = reactionOf(ticket, reactions);
    const reactDue = parseTime(ticket.reactDueAt);
    if (reaction !== null) {
      reactionMeasured += 1;
      reactionSum += reaction;
      if (reactDue !== null && created !== null) {
        reactionKnown += 1;
        const allowed = Math.max(0, Math.round((reactDue - created) / 60_000));
        if (reaction > allowed) {
          reactionBreaches += 1;
        } else {
          reactionOnTime += 1;
        }
      }
    }

    byPriority.set(priorityKey(ticket), priority);
    byDepartment.set(departmentKey(ticket), department);
  }

  const summary: SlaSummary = {
    total: base.total,
    closed: base.closed,
    open: base.open,
    cancelled,
    dueKnown: base.dueKnown,
    onTimeClosed: base.onTimeClosed,
    lateClosed: base.lateClosed,
    openOverdue: base.openOverdue,
    atRisk,
    slaOnTimePercent: percent(base.onTimeClosed, base.dueKnown),
    reactionKnown,
    reactionMeasured,
    reactionOnTime,
    reactionBreaches,
    reactionOnTimePercent: percent(reactionOnTime, reactionKnown),
    avgReactionMinutes: avg(reactionSum, reactionMeasured),
    avgResolutionMinutes: avg(base.resolutionSum, base.resolutionCount),
    avgLateMinutes: avg(base.lateSum, base.lateCount),
  };

  worst.sort((left, right) => right.lateMinutes - left.lateMinutes || left.number.localeCompare(right.number));
  return { summary, worst: worst.slice(0, WORST_LIMIT) };
}

function priorityRows(byPriority: Map<string, Counters>): SlaPriorityRow[] {
  return [...byPriority.entries()]
    .filter(([, counters]) => counters.total > 0)
    .sort((left, right) => priorityRank(left[0]) - priorityRank(right[0]))
    .map(([key, counters]) => ({
      priority: key === 'none' ? null : (key as PriorityLevel),
      label: priorityLabel(key === 'none' ? null : (key as PriorityLevel)),
      total: counters.total,
      closed: counters.closed,
      lateClosed: counters.lateClosed,
      openOverdue: counters.openOverdue,
      breaches: counters.lateClosed + counters.openOverdue,
      onTimePercent: percent(counters.onTimeClosed, counters.dueKnown),
      avgResolutionMinutes: avg(counters.resolutionSum, counters.resolutionCount),
      avgLateMinutes: avg(counters.lateSum, counters.lateCount),
    }));
}

function departmentRows(byDepartment: Map<string, Counters>, data: ReferenceData | undefined): SlaDepartmentRow[] {
  return [...byDepartment.entries()]
    .map(([key, counters]) => {
      const id = key === 'none' ? null : key;
      return {
        departmentId: id,
        label: departmentLabel(data, id),
        total: counters.total,
        closed: counters.closed,
        lateClosed: counters.lateClosed,
        openOverdue: counters.openOverdue,
        breaches: counters.lateClosed + counters.openOverdue,
        onTimePercent: percent(counters.onTimeClosed, counters.dueKnown),
        avgResolutionMinutes: avg(counters.resolutionSum, counters.resolutionCount),
      };
    })
    .sort(
      (left, right) =>
        right.breaches - left.breaches ||
        right.total - left.total ||
        left.label.localeCompare(right.label),
    );
}

function priorityRank(key: string): number {
  if (key === 'none') return PRIORITY_ORDER.length;
  const index = PRIORITY_ORDER.indexOf(key as PriorityLevel);
  return index < 0 ? PRIORITY_ORDER.length + 1 : index;
}

/** Считает О3 по заявкам и журналу событий: сроки, нарушения, разрезы и топ-5 худших. */
export async function computeSla(params: SlaParams, deps: SlaDeps): Promise<SlaResult> {
  const now = deps.clock.now().getTime();
  const period = periodOf(params, deps.clock.now());
  const from = Date.parse(period.from);
  const to = Date.parse(period.to);

  const tickets = (await deps.db.listTickets({ limit: MAX_TICKETS })).filter(
    (ticket) => inPeriod(ticket, from, to) && matchesFilters(ticket, params),
  );
  const events = await deps.db.listEvents({ limit: MAX_EVENTS });
  const resolutions = resolutionsOf(events);
  const reactions = reactionTimesOf(events);
  const names = readEngineerNames(deps.data);

  const byPriority = new Map<string, Counters>();
  const byDepartment = new Map<string, Counters>();
  const totals = collectTotals(tickets, resolutions, reactions, now, names, byPriority, byDepartment);

  return {
    period,
    filters: {
      ...(params.priority ? { priority: params.priority } : {}),
      ...(params.assigneeId ? { assigneeId: params.assigneeId } : {}),
    },
    summary: totals.summary,
    byPriority: priorityRows(byPriority),
    byDepartment: departmentRows(byDepartment, deps.data),
    worst: totals.worst,
  };
}
