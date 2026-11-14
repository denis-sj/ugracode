import type { Ticket } from '@ugra/contracts';
import type { KernelStore, ReferenceData } from '@ugra/core';
import type {
  HotspotPeriod,
  HotspotRow,
  HotspotsParams,
  HotspotsResult,
} from '../contracts';

/**
 * Расчёт О2 «Горячие точки оборудования». Цифры считает только код:
 * повторные заявки группируются по единице техники (`equipmentId`), а без неё — по кабинету.
 */

export interface HotspotsDeps {
  db: KernelStore;
  data?: ReferenceData;
  clock: { now(): Date };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS = 30;
const TOP_ROWS = 10;
const MAX_TICKETS = 100_000;
const MAX_EVENTS = 100_000;

const BUILDING_BY_CODE: Record<string, string> = {
  a: 'А',
  b: 'Б',
  v: 'В',
  prom: 'ПРОМ',
};

interface Group {
  kind: 'equipment' | 'cabinet';
  equipmentId: string | null;
  code: string;
  cabinet: string;
  count: number;
  resolutionSum: number;
  resolutionCount: number;
  categories: Map<string, number>;
  /** Заявка, по которой возьмём подпись техники из поля `equipment`. */
  sampleTicketId: string;
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function percent(part: number, total: number): number {
  return total === 0 ? 0 : round((part / total) * 100);
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
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

function buildingLabel(data: ReferenceData | undefined, building: string): string {
  const item = data?.dictionaries.find(
    (entry) => entry.dictionary === 'building' && entry.code === building,
  );
  return item?.label ?? `Корпус ${building}`;
}

function categoryLabel(data: ReferenceData | undefined, category: string | null): string | null {
  if (!category) return null;
  const item = data?.dictionaries.find(
    (entry) => entry.dictionary === 'category' && entry.code === category,
  );
  return item?.label ?? category;
}

/** Корпус в параметрах можно задать подписью («Б»), кодом (`b`) или кодом места (`cab-b-312`). */
function matchesBuilding(ticket: Ticket, filter: string): boolean {
  const location = parseLocation(ticket.locationId);
  if (!location) return false;
  const building = buildingOf(location.code);
  const normalized = filter.trim().toLowerCase();
  return (
    normalized === building.toLowerCase() ||
    normalized === location.code ||
    normalized === `cab-${location.code}` ||
    normalized === ticket.locationId?.toLowerCase()
  );
}

function inPeriod(ticket: Ticket, from: number, to: number): boolean {
  const created = parseTime(ticket.createdAt);
  return created !== null && created >= from && created <= to;
}

function matchesFilters(ticket: Ticket, params: HotspotsParams): boolean {
  if (params.category && ticket.category !== params.category) return false;
  if (params.building && !matchesBuilding(ticket, params.building)) return false;
  return true;
}

function periodOf(params: HotspotsParams, now: Date): HotspotPeriod {
  const days = params.days ?? DEFAULT_DAYS;
  const to = now.getTime();
  const from = to - days * DAY_MS;
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString(), days };
}

function previousPeriod(period: HotspotPeriod): HotspotPeriod {
  const from = Date.parse(period.from);
  const to = from - 1;
  return {
    from: new Date(from - period.days * DAY_MS).toISOString(),
    to: new Date(to).toISOString(),
    days: period.days,
  };
}

interface Resolution {
  at: number;
  minutes: number;
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
  if (ticket.status !== 'closed' && ticket.status !== 'resolved') return null;
  const updated = parseTime(ticket.updatedAt);
  if (created === null || updated === null) return null;
  return Math.max(0, Math.round((updated - created) / 60_000));
}

function groupKey(ticket: Ticket): { key: string; kind: 'equipment' | 'cabinet'; code: string; cabinet: string } | null {
  const location = parseLocation(ticket.locationId);
  if (!location) return null;
  if (ticket.equipmentId) {
    return { key: `eq:${ticket.equipmentId}`, kind: 'equipment', code: location.code, cabinet: location.cabinet };
  }
  return {
    key: `cab:${location.code}:${location.cabinet}`,
    kind: 'cabinet',
    code: location.code,
    cabinet: location.cabinet,
  };
}

function collectGroups(
  tickets: readonly Ticket[],
  resolutions: Map<string, Resolution>,
): Map<string, Group> {
  const groups = new Map<string, Group>();
  for (const ticket of tickets) {
    const identity = groupKey(ticket);
    if (!identity) continue;
    let group = groups.get(identity.key);
    if (!group) {
      group = {
        kind: identity.kind,
        equipmentId: identity.kind === 'equipment' ? ticket.equipmentId : null,
        code: identity.code,
        cabinet: identity.cabinet,
        count: 0,
        resolutionSum: 0,
        resolutionCount: 0,
        categories: new Map<string, number>(),
        sampleTicketId: ticket.id,
      };
      groups.set(identity.key, group);
    }
    group.count += 1;
    const minutes = resolutionMinutes(ticket, resolutions);
    if (minutes !== null) {
      group.resolutionSum += minutes;
      group.resolutionCount += 1;
    }
    if (ticket.category) {
      group.categories.set(ticket.category, (group.categories.get(ticket.category) ?? 0) + 1);
    }
  }
  return groups;
}

function topCategory(group: Group): string | null {
  let best: string | null = null;
  let bestCount = 0;
  for (const [category, count] of group.categories) {
    if (count > bestCount) {
      best = category;
      bestCount = count;
    }
  }
  return best;
}

function equipmentName(fields: readonly { fieldKey: string; value: string | number | null }[]): string | null {
  const field = fields.find((item) => item.fieldKey === 'equipment');
  if (field === undefined || field.value === null) return null;
  const text = String(field.value).trim();
  return text === '' ? null : text;
}

async function loadRow(
  key: string,
  group: Group,
  db: KernelStore,
  data: ReferenceData | undefined,
  total: number,
  previousCount: number,
): Promise<HotspotRow> {
  const building = buildingOf(group.code);
  const buildingText = buildingLabel(data, building);
  const category = topCategory(group);
  let label = `${buildingText} · каб. ${group.cabinet}`;
  if (group.kind === 'equipment') {
    const fields = await db.getTicketFields(group.sampleTicketId);
    const name = equipmentName(fields);
    const kindLabel = categoryLabel(data, category) ?? 'Оборудование';
    label = `${name ?? kindLabel} · ${label}`;
  }
  return {
    key,
    kind: group.kind,
    equipmentId: group.equipmentId,
    label,
    building,
    cabinet: group.cabinet,
    category,
    count: group.count,
    sharePercent: percent(group.count, total),
    avgResolutionMinutes:
      group.resolutionCount === 0 ? null : Math.round(group.resolutionSum / group.resolutionCount),
    previousCount,
    trendPercent:
      previousCount === 0 ? null : round(((group.count - previousCount) / previousCount) * 100),
  };
}

/** Считает О2 по заявкам и событиям: топ-10 техники и кабинетов, доля, время решения, тренд. */
export async function computeHotspots(
  params: HotspotsParams,
  deps: HotspotsDeps,
): Promise<HotspotsResult> {
  const period = periodOf(params, deps.clock.now());
  const previous = previousPeriod(period);
  const from = Date.parse(period.from);
  const to = Date.parse(period.to);
  const previousFrom = Date.parse(previous.from);
  const previousTo = Date.parse(previous.to);

  const tickets = await deps.db.listTickets({ limit: MAX_TICKETS });
  const resolutions = resolutionsOf(await deps.db.listEvents({ limit: MAX_EVENTS }));

  const currentTickets = tickets.filter(
    (ticket) => inPeriod(ticket, from, to) && matchesFilters(ticket, params),
  );
  const previousTickets = tickets.filter(
    (ticket) => inPeriod(ticket, previousFrom, previousTo) && matchesFilters(ticket, params),
  );

  const groups = collectGroups(currentTickets, resolutions);
  const previousGroups = collectGroups(previousTickets, resolutions);

  const ranked = [...groups.entries()]
    .sort(
      (left, right) =>
        right[1].count - left[1].count ||
        // При равном числе заявок техника важнее кабинета: у неё понятная причина повтора.
        (left[1].kind === right[1].kind
          ? left[0].localeCompare(right[0])
          : left[1].kind === 'equipment'
            ? -1
            : 1),
    )
    .slice(0, TOP_ROWS);

  const rows: HotspotRow[] = [];
  for (const [key, group] of ranked) {
    rows.push(
      await loadRow(
        key,
        group,
        deps.db,
        deps.data,
        currentTickets.length,
        previousGroups.get(key)?.count ?? 0,
      ),
    );
  }

  const repeatedTickets = rows.reduce((sum, row) => sum + (row.count >= 2 ? row.count : 0), 0);
  const previousTotal = previousTickets.length;

  return {
    period,
    previousPeriod: previous,
    filters: {
      ...(params.building ? { building: params.building } : {}),
      ...(params.category ? { category: params.category } : {}),
    },
    total: currentTickets.length,
    previousTotal,
    trendPercent:
      previousTotal === 0
        ? null
        : round(((currentTickets.length - previousTotal) / previousTotal) * 100),
    repeatedTickets,
    rows,
  };
}
