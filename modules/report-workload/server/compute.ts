import { readFileSync } from 'node:fs';
import type { Ticket, TicketStatus } from '@ugra/contracts';
import type { KernelStore, ReferenceData } from '@ugra/core';
import type {
  WorkloadDepartmentRow,
  WorkloadEngineerRow,
  WorkloadParams,
  WorkloadPeriod,
  WorkloadResult,
  WorkloadSummary,
} from '../contracts';

/**
 * Расчёт О4 «Нагрузка инженеров». Цифры считает только код.
 *
 * «Открытые» — текущий портфель исполнителя (статус в работе прямо сейчас, без привязки к дате
 * создания), «закрытые» — заявки, закрытые за период. Так отчёт отвечает на вопрос «кого разгрузить»,
 * а не только «сколько человек сделал за месяц».
 */

export interface WorkloadDeps {
  db: KernelStore;
  data?: ReferenceData;
  clock: { now(): Date };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS = 30;
const DEFAULT_OVERLOAD = 5;
const MAX_TICKETS = 100_000;
const MAX_EVENTS = 100_000;

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

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
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

function periodOf(params: WorkloadParams, now: Date): WorkloadPeriod {
  const days = params.days ?? DEFAULT_DAYS;
  const to = now.getTime();
  return { from: new Date(to - days * DAY_MS).toISOString(), to: new Date(to).toISOString(), days };
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

/** Когда заявка закрылась; для закрытой без события — `updatedAt`. */
function closedAt(ticket: Ticket, resolutions: Map<string, Resolution>): number | null {
  const known = resolutions.get(ticket.id);
  if (known) return known.at;
  if (!isClosed(ticket.status)) return null;
  return parseTime(ticket.updatedAt);
}

function resolutionMinutes(ticket: Ticket, resolutions: Map<string, Resolution>): number | null {
  const closed = closedAt(ticket, resolutions);
  if (closed === null) return null;
  const known = resolutions.get(ticket.id);
  if (known && known.minutes > 0) return known.minutes;
  const created = parseTime(ticket.createdAt);
  return created === null ? null : Math.max(0, Math.round((closed - created) / 60_000));
}

function overloadThreshold(data: ReferenceData | undefined): number {
  const raw = data?.settings['workload.overloadOpen'];
  const parsed = typeof raw === 'string' ? Number(raw) : raw;
  return typeof parsed === 'number' && Number.isFinite(parsed) && parsed > 0
    ? Math.round(parsed)
    : DEFAULT_OVERLOAD;
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

interface EngineerBucket {
  assigneeId: string | null;
  departmentId: string | null;
  open: number;
  closed: number;
  resolutionSum: number;
  resolutionCount: number;
}

interface DepartmentBucket {
  open: number;
  closed: number;
  engineers: Set<string>;
}

function departmentKey(ticket: Ticket): string {
  return ticket.departmentId ?? 'none';
}

function engineerKey(ticket: Ticket): string {
  return ticket.assigneeId ?? 'none';
}

function emptyDepartment(): DepartmentBucket {
  return { open: 0, closed: 0, engineers: new Set<string>() };
}

function engineerRows(
  buckets: Map<string, EngineerBucket>,
  threshold: number,
  names: Map<string, string>,
  data: ReferenceData | undefined,
): WorkloadEngineerRow[] {
  return [...buckets.entries()]
    .map(([key, bucket]) => {
      const id = key === 'none' ? null : key;
      const total = bucket.open + bucket.closed;
      return {
        assigneeId: id,
        name: engineerName(names, id),
        departmentId: bucket.departmentId,
        departmentLabel: departmentLabel(data, bucket.departmentId),
        open: bucket.open,
        closed: bucket.closed,
        total,
        avgResolutionMinutes:
          bucket.resolutionCount === 0
            ? null
            : Math.round(bucket.resolutionSum / bucket.resolutionCount),
        overload: bucket.open > threshold,
      };
    })
    .sort(
      (left, right) =>
        right.open - left.open ||
        right.closed - left.closed ||
        left.name.localeCompare(right.name),
    );
}

function departmentRows(
  buckets: Map<string, DepartmentBucket>,
  totalOpen: number,
  threshold: number,
  data: ReferenceData | undefined,
): WorkloadDepartmentRow[] {
  return [...buckets.entries()]
    .map(([key, bucket]) => {
      const id = key === 'none' ? null : key;
      const engineers = bucket.engineers.size;
      return {
        departmentId: id,
        label: departmentLabel(data, id),
        engineers,
        open: bucket.open,
        closed: bucket.closed,
        openSharePercent: totalOpen === 0 ? 0 : round((bucket.open / totalOpen) * 100),
        avgOpenPerEngineer: engineers === 0 ? 0 : round(bucket.open / engineers),
        overloadedEngineers: 0,
      };
    })
    .sort(
      (left, right) =>
        right.open - left.open ||
        right.closed - left.closed ||
        left.label.localeCompare(right.label),
    );
}

/** Считает О4 по заявкам: текущая нагрузка, поток закрытых, перегруз и баланс подразделений. */
export async function computeWorkload(
  params: WorkloadParams,
  deps: WorkloadDeps,
): Promise<WorkloadResult> {
  const period = periodOf(params, deps.clock.now());
  const from = Date.parse(period.from);
  const to = Date.parse(period.to);

  const tickets = await deps.db.listTickets({ limit: MAX_TICKETS });
  const resolutions = resolutionsOf(await deps.db.listEvents({ limit: MAX_EVENTS }));
  const threshold = overloadThreshold(deps.data);
  const names = readEngineerNames(deps.data);

  const engineers = new Map<string, EngineerBucket>();
  const departments = new Map<string, DepartmentBucket>();
  let totalOpen = 0;
  let totalClosed = 0;
  let resolutionSum = 0;
  let resolutionCount = 0;

  for (const ticket of tickets) {
    if (params.departmentId && ticket.departmentId !== params.departmentId) continue;
    if (ticket.status === 'cancelled') continue;

    const open = isOpen(ticket.status);
    const closed = closedAt(ticket, resolutions);
    const closedInPeriod = !open && closed !== null && closed >= from && closed <= to;
    if (!open && !closedInPeriod) continue;

    const key = engineerKey(ticket);
    const bucket = engineers.get(key) ?? {
      assigneeId: ticket.assigneeId,
      departmentId: ticket.departmentId,
      open: 0,
      closed: 0,
      resolutionSum: 0,
      resolutionCount: 0,
    };
    const department = departments.get(departmentKey(ticket)) ?? emptyDepartment();
    if (ticket.assigneeId !== null) department.engineers.add(ticket.assigneeId);

    if (open) {
      bucket.open += 1;
      department.open += 1;
      totalOpen += 1;
    } else {
      bucket.closed += 1;
      department.closed += 1;
      totalClosed += 1;
      const minutes = resolutionMinutes(ticket, resolutions);
      if (minutes !== null) {
        bucket.resolutionSum += minutes;
        bucket.resolutionCount += 1;
        resolutionSum += minutes;
        resolutionCount += 1;
      }
    }

    engineers.set(key, bucket);
    departments.set(departmentKey(ticket), department);
  }

  const rows = engineerRows(engineers, threshold, names, deps.data);
  const departmentList = departmentRows(departments, totalOpen, threshold, deps.data);
  for (const department of departmentList) {
    department.overloadedEngineers = rows.filter(
      (row) =>
        row.overload &&
        row.assigneeId !== null &&
        row.departmentId === department.departmentId,
    ).length;
  }

  const engineersWithTickets = rows.filter((row) => row.assigneeId !== null).length;
  const summary: WorkloadSummary = {
    totalOpen,
    totalClosed,
    engineers: engineersWithTickets,
    overloaded: rows.filter((row) => row.overload && row.assigneeId !== null).length,
    avgOpenPerEngineer: engineersWithTickets === 0 ? 0 : round(totalOpen / engineersWithTickets),
    avgResolutionMinutes: resolutionCount === 0 ? null : Math.round(resolutionSum / resolutionCount),
    overloadThreshold: threshold,
  };

  return {
    period,
    filters: { ...(params.departmentId ? { departmentId: params.departmentId } : {}) },
    summary,
    byEngineer: rows,
    byDepartment: departmentList,
  };
}
