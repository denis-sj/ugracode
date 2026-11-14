import { readFileSync } from 'node:fs';
import type { Ticket, TicketStatus } from '@ugra/contracts';
import type { KernelStore } from '@ugra/core';
import type {
  ShiftAssigneeRow,
  ShiftAttention,
  ShiftParams,
  ShiftPeriod,
  ShiftResult,
  ShiftTicketRef,
  ShiftTotals,
} from '../contracts';

/**
 * Расчёт О1 «Сводка смены». Смена — календарный день по часам ядра.
 * Цифры считает код; текст вывода — отдельно, только по фактам.
 */

export interface ShiftDeps {
  db: KernelStore;
  clock: { now(): Date };
}

const MAX_TICKETS = 100_000;
const MAX_EVENTS = 100_000;
const MAX_ATTENTION_ROWS = 20;
const NONE_ASSIGNEE = 'Не назначено';

const OPEN_STATUSES: readonly TicketStatus[] = [
  'new',
  'ai_draft',
  'waiting_applicant',
  'in_review',
  'assigned',
  'in_progress',
];

interface Resolution {
  at: number;
  minutes: number;
}

let engineerNames: Map<string, string> | null = null;

function engineerName(id: string | null): string {
  if (id === null) return NONE_ASSIGNEE;
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

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function dayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dayStart(value: string): Date | null {
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function periodOf(params: ShiftParams, now: Date): ShiftPeriod {
  const requested = params.date ? dayStart(params.date) : null;
  const start = requested ?? new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start.getTime());
  end.setDate(end.getDate() + 1);
  return {
    date: dayKey(start),
    from: start.toISOString(),
    to: end.toISOString(),
  };
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function within(time: number | null, from: number, to: number): boolean {
  return time !== null && time >= from && time < to;
}

function isOpen(status: TicketStatus): boolean {
  return OPEN_STATUSES.includes(status);
}

function isClosed(status: TicketStatus): boolean {
  return status === 'closed' || status === 'resolved';
}

function resolutionsOf(
  events: readonly { type: string; at: string; ticketId?: string; payload: unknown }[],
): Map<string, Resolution> {
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

function resolutionMinutes(ticket: Ticket, resolutions: Map<string, Resolution>): number | null {
  const known = resolutions.get(ticket.id);
  if (known && known.minutes > 0) return known.minutes;
  const created = parseTime(ticket.createdAt);
  if (known && created !== null) return Math.max(0, Math.round((known.at - created) / 60_000));
  if (!isClosed(ticket.status)) return null;
  const updated = parseTime(ticket.updatedAt);
  if (created === null || updated === null) return null;
  return Math.max(0, Math.round((updated - created) / 60_000));
}

/** Заявка, которая была в работе в эту смену: поступила, менялась или закрылась в этот день. */
function inShift(
  ticket: Ticket,
  from: number,
  to: number,
  resolutions: Map<string, Resolution>,
): boolean {
  if (within(parseTime(ticket.createdAt), from, to)) return true;
  if (within(parseTime(ticket.updatedAt), from, to)) return true;
  return within(resolutions.get(ticket.id)?.at ?? null, from, to);
}

function refOf(ticket: Ticket): ShiftTicketRef {
  return {
    id: ticket.id,
    number: ticket.number,
    status: ticket.status,
    priority: ticket.priority,
    category: ticket.category,
    assigneeId: ticket.assigneeId,
    createdAt: ticket.createdAt,
    slaDueAt: ticket.slaDueAt,
  };
}

/** Когда заявка закрылась именно в эту смену; иначе `null`. */
function closedAt(
  ticket: Ticket,
  from: number,
  to: number,
  resolutions: Map<string, Resolution>,
): number | null {
  const known = resolutions.get(ticket.id);
  if (known && within(known.at, from, to)) return known.at;
  if (!isClosed(ticket.status)) return null;
  const updated = parseTime(ticket.updatedAt);
  return within(updated, from, to) ? updated : null;
}

function totalsOf(
  tickets: readonly Ticket[],
  from: number,
  to: number,
  resolutions: Map<string, Resolution>,
): ShiftTotals {
  let created = 0;
  let closed = 0;
  let emergency = 0;
  let breaches = 0;
  let dueClosed = 0;

  for (const ticket of tickets) {
    if (ticket.isEmergency) emergency += 1;
    if (within(parseTime(ticket.createdAt), from, to)) created += 1;
    const resolvedAt = closedAt(ticket, from, to, resolutions);
    if (resolvedAt === null) continue;
    closed += 1;
    const due = parseTime(ticket.slaDueAt);
    if (due === null) continue;
    dueClosed += 1;
    if (resolvedAt > due) breaches += 1;
  }
  return {
    total: tickets.length,
    created,
    closed,
    emergency,
    slaBreaches: breaches,
    slaOnTimePercent: dueClosed === 0 ? null : round(((dueClosed - breaches) / dueClosed) * 100),
  };
}

function byAssigneeOf(
  tickets: readonly Ticket[],
  from: number,
  to: number,
  resolutions: Map<string, Resolution>,
): ShiftAssigneeRow[] {
  const rows = new Map<
    string,
    { total: number; open: number; closed: number; sum: number; count: number }
  >();

  for (const ticket of tickets) {
    const key = ticket.assigneeId ?? '';
    const row = rows.get(key) ?? { total: 0, open: 0, closed: 0, sum: 0, count: 0 };
    row.total += 1;
    if (isOpen(ticket.status)) row.open += 1;
    if (closedAt(ticket, from, to, resolutions) !== null) {
      row.closed += 1;
      const minutes = resolutionMinutes(ticket, resolutions);
      if (minutes !== null) {
        row.sum += minutes;
        row.count += 1;
      }
    }
    rows.set(key, row);
  }

  return [...rows.entries()]
    .map(([key, row]) => ({
      assigneeId: key === '' ? null : key,
      name: engineerName(key === '' ? null : key),
      total: row.total,
      open: row.open,
      closed: row.closed,
      avgResolutionMinutes: row.count === 0 ? null : Math.round(row.sum / row.count),
    }))
    .sort((left, right) => right.total - left.total || left.name.localeCompare(right.name));
}

function attentionOf(
  tickets: readonly Ticket[],
  period: ShiftPeriod,
  now: Date,
): ShiftAttention {
  const from = Date.parse(period.from);
  const to = Date.parse(period.to);
  // Для сегодняшней смены просрочка считается на текущий момент, для прошлой — на конец дня.
  const asOf = Math.min(now.getTime(), to);

  const overdue = tickets
    .filter((ticket) => {
      if (!isOpen(ticket.status)) return false;
      const due = parseTime(ticket.slaDueAt);
      return due !== null && due < asOf;
    })
    .sort((left, right) => (parseTime(left.slaDueAt) ?? 0) - (parseTime(right.slaDueAt) ?? 0));

  const waitingReview = tickets
    .filter((ticket) => ticket.status === 'in_review')
    .sort((left, right) => (parseTime(left.createdAt) ?? from) - (parseTime(right.createdAt) ?? from));

  return {
    overdue: overdue.slice(0, MAX_ATTENTION_ROWS).map(refOf),
    overdueCount: overdue.length,
    waitingReview: waitingReview.slice(0, MAX_ATTENTION_ROWS).map(refOf),
    waitingReviewCount: waitingReview.length,
  };
}

/** Считает О1 по заявкам и событиям за календарный день. */
export async function computeShift(params: ShiftParams, deps: ShiftDeps): Promise<ShiftResult> {
  const now = deps.clock.now();
  const period = periodOf(params, now);
  const from = Date.parse(period.from);
  const to = Date.parse(period.to);

  const tickets = await deps.db.listTickets({ limit: MAX_TICKETS });
  const resolutions = resolutionsOf(await deps.db.listEvents({ limit: MAX_EVENTS }));
  const dayTickets = tickets.filter((ticket) => inShift(ticket, from, to, resolutions));

  return {
    period,
    totals: totalsOf(dayTickets, from, to, resolutions),
    byAssignee: byAssigneeOf(dayTickets, from, to, resolutions),
    attention: attentionOf(dayTickets, period, now),
  };
}
