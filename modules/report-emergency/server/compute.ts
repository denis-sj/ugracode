import type { Ticket, TicketField, TicketStatus } from '@ugra/contracts';
import type { KernelStore, ReferenceData } from '@ugra/core';
import type {
  EmergencyHotspot,
  EmergencyParams,
  EmergencyPeriod,
  EmergencyResult,
  EmergencySummary,
  EmergencyTicketRef,
} from '../contracts';

/**
 * Расчёт О7 «Аварии». Цифры считает только код.
 *
 * Авария — заявка с `isEmergency` (её ставит подтверждение приоритета или аварийный сигнал).
 * Повторные аварии группируются по технике (`equipmentId`), без неё — по месту (`locationId`).
 * Ложные тревоги считаются по журналу `emergency.detected`: сигнал «под вопросом», который
 * не стал аварией в заявке. Нет событий — `falseAlarms: null`, а не ноль: цифру не выдумываем.
 */

export interface EmergencyDeps {
  db: KernelStore;
  data?: ReferenceData;
  clock: { now(): Date };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS = 30;
const MAX_TICKETS = 100_000;
const MAX_EVENTS = 100_000;
const RECENT_LIMIT = 5;

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

interface PeriodEvent {
  type: string;
  at: string;
  ticketId?: string;
  payload: unknown;
}

interface Group {
  kind: 'equipment' | 'location';
  equipmentId: string | null;
  locationId: string | null;
  label: string;
  count: number;
  lastAt: number;
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

function periodOf(params: EmergencyParams, now: Date): EmergencyPeriod {
  const days = params.days ?? DEFAULT_DAYS;
  const to = now.getTime();
  return { from: new Date(to - days * DAY_MS).toISOString(), to: new Date(to).toISOString(), days };
}

function inPeriod(ticket: Ticket, from: number, to: number): boolean {
  const created = parseTime(ticket.createdAt);
  return created !== null && created >= from && created <= to;
}

export function parseLocation(locationId: string | null): { code: string; cabinet: string } | null {
  if (!locationId) return null;
  const match = /^cab-([a-z]+)-(.+)$/.exec(locationId);
  if (!match) return null;
  const code = match[1];
  const cabinet = match[2];
  if (!code || !cabinet) return null;
  return { code, cabinet };
}

function buildingOf(code: string): string {
  return BUILDING_BY_CODE[code] ?? code.toUpperCase();
}

function locationLabel(locationId: string | null, data: ReferenceData | undefined): string {
  const location = parseLocation(locationId);
  if (!location) return locationId ?? 'Место не указано';
  const building = buildingOf(location.code);
  const dictionary = data?.dictionaries.find(
    (entry) => entry.dictionary === 'building' && entry.code === building,
  );
  return `${dictionary?.label ?? `Корпус ${building}`} · каб. ${location.cabinet}`;
}

function reactionTimesOf(events: readonly PeriodEvent[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const event of events) {
    if (!event.ticketId) continue;
    const at = parseTime(event.at);
    if (at === null) continue;
    let reaction = false;
    if (event.type === 'ticket.assigned') reaction = true;
    else if (event.type === 'ticket.status.changed' && typeof event.payload === 'object' && event.payload !== null) {
      const to = (event.payload as { to?: unknown }).to;
      reaction = to === 'assigned' || to === 'in_progress';
    }
    if (!reaction) continue;
    const current = map.get(event.ticketId);
    if (current === undefined || at < current) map.set(event.ticketId, at);
  }
  return map;
}

function reactionMinutes(ticket: Ticket, reactions: Map<string, number>): number | null {
  const created = parseTime(ticket.createdAt);
  if (created === null) return null;
  const candidates: number[] = [];
  const confirmed = parseTime(ticket.confirmedAt);
  if (confirmed !== null) candidates.push(confirmed);
  const assigned = reactions.get(ticket.id);
  if (assigned !== undefined) candidates.push(assigned);
  if (candidates.length === 0) return null;
  return Math.max(0, Math.round((Math.min(...candidates) - created) / 60_000));
}

function equipmentName(fields: readonly TicketField[]): string | null {
  const field = fields.find((item) => item.fieldKey === 'equipment');
  if (field === undefined || field.value === null) return null;
  const text = String(field.value).trim();
  return text === '' ? null : text;
}

function hotspotKey(ticket: Ticket): { key: string; kind: 'equipment' | 'location' } {
  if (ticket.equipmentId) return { key: `eq:${ticket.equipmentId}`, kind: 'equipment' };
  return { key: `loc:${ticket.locationId ?? 'none'}`, kind: 'location' };
}

function groupLabel(
  kind: 'equipment' | 'location',
  ticket: Ticket,
  name: string | null,
  data: ReferenceData | undefined,
): string {
  const place = locationLabel(ticket.locationId, data);
  if (kind === 'equipment') return `${name ?? ticket.equipmentId ?? 'Оборудование'} · ${place}`;
  return place;
}

async function hotspotsOf(
  tickets: readonly Ticket[],
  db: KernelStore,
  data: ReferenceData | undefined,
  totalEmergencies: number,
): Promise<EmergencyHotspot[]> {
  const groups = new Map<string, Group>();
  for (const ticket of tickets) {
    const identity = hotspotKey(ticket);
    const group = groups.get(identity.key);
    if (group) {
      group.count += 1;
      group.lastAt = Math.max(group.lastAt, parseTime(ticket.createdAt) ?? 0);
      continue;
    }
    groups.set(identity.key, {
      kind: identity.kind,
      equipmentId: ticket.equipmentId,
      locationId: ticket.locationId,
      label: '',
      count: 1,
      lastAt: parseTime(ticket.createdAt) ?? 0,
    });
  }

  const repeated = [...groups.entries()].filter(([, group]) => group.count >= 2);
  const rows: EmergencyHotspot[] = [];
  for (const [key, group] of repeated) {
    let name: string | null = null;
    if (group.kind === 'equipment') {
      const sample = tickets.find((ticket) => `eq:${ticket.equipmentId ?? ''}` === key);
      if (sample) name = equipmentName(await db.getTicketFields(sample.id));
    }
    const sample = tickets.find((ticket) => hotspotKey(ticket).key === key);
    rows.push({
      key,
      kind: group.kind,
      equipmentId: group.equipmentId,
      locationId: group.locationId,
      label: sample ? groupLabel(group.kind, sample, name, data) : group.locationId ?? key,
      count: group.count,
      sharePercent: totalEmergencies === 0 ? 0 : round((group.count / totalEmergencies) * 100),
      lastAt: new Date(group.lastAt).toISOString(),
    });
  }

  return rows.sort(
    (left, right) => right.count - left.count || left.label.localeCompare(right.label),
  );
}

function refOf(ticket: Ticket): EmergencyTicketRef {
  return {
    id: ticket.id,
    number: ticket.number,
    createdAt: ticket.createdAt,
    status: ticket.status,
    priority: ticket.priority,
    equipmentId: ticket.equipmentId,
    locationId: ticket.locationId,
  };
}

function signalsOf(events: readonly PeriodEvent[], from: number, to: number): { detected: number; suspected: number } {
  let detected = 0;
  let suspected = 0;
  for (const event of events) {
    if (event.type !== 'emergency.detected') continue;
    const at = parseTime(event.at);
    if (at === null || at < from || at > to) continue;
    detected += 1;
    if (typeof event.payload === 'object' && event.payload !== null) {
      if ((event.payload as { level?: unknown }).level === 'suspected') suspected += 1;
    }
  }
  return { detected, suspected };
}

/** Считает О7: число и доля аварий, реакция, повторные аварии и ложные тревоги. */
export async function computeEmergency(
  params: EmergencyParams,
  deps: EmergencyDeps,
): Promise<EmergencyResult> {
  const period = periodOf(params, deps.clock.now());
  const from = Date.parse(period.from);
  const to = Date.parse(period.to);

  const tickets = (await deps.db.listTickets({ limit: MAX_TICKETS })).filter(
    (ticket) => ticket.status !== 'cancelled' && inPeriod(ticket, from, to),
  );
  const events = await deps.db.listEvents({ limit: MAX_EVENTS });
  const reactions = reactionTimesOf(events);
  const emergencies = tickets.filter((ticket) => ticket.isEmergency);

  let reactionSum = 0;
  let reactionCount = 0;
  let closed = 0;
  let open = 0;
  for (const ticket of emergencies) {
    const minutes = reactionMinutes(ticket, reactions);
    if (minutes !== null) {
      reactionSum += minutes;
      reactionCount += 1;
    }
    if (isOpen(ticket.status)) open += 1;
    else closed += 1;
  }

  const hotspots = await hotspotsOf(emergencies, deps.db, deps.data, emergencies.length);
  const signals = signalsOf(events, from, to);
  const summary: EmergencySummary = {
    total: tickets.length,
    emergency: emergencies.length,
    sharePercent: percent(emergencies.length, tickets.length),
    closed,
    open,
    reactionMeasured: reactionCount,
    avgReactionMinutes: reactionCount === 0 ? null : Math.round(reactionSum / reactionCount),
    repeatedHotspots: hotspots.length,
    detectedSignals: signals.detected,
    suspectedSignals: signals.suspected,
    falseAlarms: signals.detected === 0 ? null : signals.suspected,
  };

  const recent = [...emergencies]
    .sort((left, right) => (parseTime(right.createdAt) ?? 0) - (parseTime(left.createdAt) ?? 0))
    .slice(0, RECENT_LIMIT)
    .map(refOf);

  return { period, filters: {}, summary, hotspots, recent };
}
