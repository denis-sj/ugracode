import { randomUUID } from 'node:crypto';
import type { NewEvent, TicketStatus } from '@ugra/contracts';
import type { Incident, KernelStore, Ports, ReferenceData } from '@ugra/core';
import { settingNumber } from '@ugra/core';
import { classifyCandidate, placeOfTicket, sameValue, type TicketPlace } from './place';

/** Правило массовости из `data/settings.json`; значения по умолчанию — из спецификации. */
export const DEFAULT_WINDOW_MINUTES = 15;
export const DEFAULT_THRESHOLD = 5;
/** Сколько заявок просматриваем: больше окна массовости всё равно не нужно. */
const MAX_CANDIDATES = 200;

/** Минимум для публикации события: шаг получает `EventBus`, маршрут — `ModuleDeps.bus`. */
export interface EventPublisher {
  publish(event: NewEvent): Promise<void>;
}

export interface MassDeps {
  db: KernelStore;
  data: ReferenceData;
  ports: Ports;
  bus?: EventPublisher;
}

/** Что сравниваем с базой: место и система текущего обращения. */
export interface MassTarget extends TicketPlace {
  appealId: string;
}

export interface MassIncidentResult {
  incident: Incident;
  size: number;
  reason: string;
  /** Инцидент создан этим вызовом (а не найден открытым). */
  created: boolean;
  linkedTicketIds: string[];
}

function isActive(status: TicketStatus): boolean {
  return status !== 'closed' && status !== 'cancelled';
}

function withinWindow(createdAt: string, from: number, now: Date): boolean {
  const at = new Date(createdAt).getTime();
  if (Number.isNaN(at)) return false;
  return at >= from && at <= now.getTime();
}

function placeLabel(place: { building: string | null; cabinet?: string | null }): string {
  const parts = [
    place.building === null ? null : `корпус ${place.building}`,
    place.cabinet === null || place.cabinet === undefined ? null : `каб. ${place.cabinet}`,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(', ') : 'то же место';
}

/** Объяснение для карточки: почему склеили и по какому признаку. */
function buildReason(
  target: MassTarget,
  similar: number,
  signals: number,
  size: number,
  windowMinutes: number,
): string {
  if (signals > similar) {
    return `Разные системы в одном месте (${placeLabel(target)}) — вероятно, сеть или сервер: ${size} обращений за ${windowMinutes} мин.`;
  }
  const subject = target.category === null ? 'одна система' : `категория «${target.category}»`;
  return `Похожие обращения: ${subject}, ${placeLabel(target)} — ${size} за ${windowMinutes} мин.`;
}

/** Номер инцидента: `И-YYYYMMDD-NNNN`, счётчик — по инцидентам этого дня. */
async function nextNumber(db: KernelStore, now: Date): Promise<string> {
  const prefix = `И-${now.toISOString().slice(0, 10).replaceAll('-', '')}-`;
  const incidents = await db.listIncidents({ limit: 1000 });
  const today = incidents.filter((incident) => incident.number.startsWith(prefix)).length;
  return `${prefix}${String(today + 1).padStart(4, '0')}`;
}

/** Открытый инцидент с тем же местом и категорией/системой: новые похожие прикрепляются к нему. */
async function findOpenIncident(db: KernelStore, target: MassTarget): Promise<Incident | null> {
  const open = await db.listIncidents({ status: 'open', limit: 200 });
  return (
    open.find(
      (incident) =>
        sameValue(incident.building, target.building) &&
        (sameValue(incident.category, target.category) || sameValue(incident.system, target.system)),
    ) ?? null
  );
}

/** Дежурные инженеры из `data/engineers.json`; битые записи пропускаем. */
export function readDutyEngineerIds(data: ReferenceData): string[] {
  const raw = data.extra['engineers'];
  const list = Array.isArray(raw) ? raw : (raw as { engineers?: unknown } | null)?.engineers;
  if (!Array.isArray(list)) return [];
  const ids: string[] = [];
  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue;
    const record = item as { id?: unknown; onShift?: unknown };
    if (record.onShift !== true || typeof record.id !== 'string' || record.id === '') continue;
    ids.push(record.id);
  }
  return ids;
}

async function publishOpened(deps: MassDeps, incident: Incident, size: number): Promise<void> {
  try {
    await deps.bus?.publish({
      type: 'mass-incident.opened',
      actor: { kind: 'ai' },
      payload: {
        number: incident.number,
        size,
        category: incident.category,
        building: incident.building,
      },
    });
  } catch {
    // журнал не должен валить разбор обращения
  }
}

/** Уведомление дежурным: порт — заглушка, ошибка доставки не валит шаг. */
async function notifyDuty(deps: MassDeps, incident: Incident, size: number): Promise<void> {
  const title = 'Массовый сбой';
  const body = `Инцидент ${incident.number}: ${size} похожих обращений (${placeLabel(incident)}). Откройте инцидент и ответьте всем одной кнопкой.`;
  for (const toUserId of readDutyEngineerIds(deps.data)) {
    try {
      await deps.ports.notifications.send({ toUserId, channel: 'inapp', title, body });
    } catch {
      // доставка — не причина ронять разбор
    }
  }
}

/**
 * Считает массовость и при пороге создаёт/дополняет инцидент, привязывая заявки.
 *
 * | Признак | Когда | Вклад |
 * |---|---|---|
 * | `same-category` | та же категория и тот же корпус | похожее |
 * | `same-system` | одна система в том же корпусе (принтер и МФУ) | похожее |
 * | `mixed-place` | разные категории в одном месте | сигнал «вероятно, сеть или сервер» |
 *
 * Порог и окно берутся из `ctx.data.settings` (`massThreshold`, `massWindowMinutes`).
 * Возвращает `null`, если похожих меньше порога.
 */
export async function openMassIncident(
  deps: MassDeps,
  target: MassTarget,
): Promise<MassIncidentResult | null> {
  if (target.category === null || target.building === null) return null;

  const windowMinutes = Math.max(
    1,
    Math.round(settingNumber(deps.data, 'massWindowMinutes', DEFAULT_WINDOW_MINUTES)),
  );
  const threshold = Math.max(1, Math.round(settingNumber(deps.data, 'massThreshold', DEFAULT_THRESHOLD)));
  const now = deps.ports.clock.now();
  const from = now.getTime() - windowMinutes * 60_000;

  const tickets = await deps.db.listTickets({ limit: MAX_CANDIDATES });
  const current =
    tickets.find(
      (ticket) => ticket.appealId === target.appealId && isActive(ticket.status) && withinWindow(ticket.createdAt, from, now),
    ) ?? null;
  const others = tickets.filter(
    (ticket) => ticket.appealId !== target.appealId && isActive(ticket.status) && withinWindow(ticket.createdAt, from, now),
  );

  const classified = await Promise.all(
    others.map(async (ticket) => ({
      ticket,
      kind: classifyCandidate(target, placeOfTicket(ticket, await deps.db.getTicketFields(ticket.id))),
    })),
  );
  const similar = classified.filter((item) => item.kind === 'same-category' || item.kind === 'same-system');
  const signals = classified.filter((item) => item.kind === 'mixed-place');
  const size = similar.length + signals.length + (current === null ? 0 : 1);
  if (size < threshold) return null;

  let incident = await findOpenIncident(deps.db, target);
  const created = incident === null;
  if (incident === null) {
    incident = {
      id: randomUUID(),
      number: await nextNumber(deps.db, now),
      status: 'open',
      category: target.category,
      building: target.building,
      system: target.system,
      size: 0,
      priority: 'emergency',
      openedAt: now.toISOString(),
      closedAt: null,
    };
    await deps.db.saveIncident(incident);
  }

  const attached = [...similar, ...signals].map((item) => item.ticket);
  if (current !== null) attached.push(current);
  const linkedTicketIds: string[] = [];
  for (const ticket of attached) {
    if (ticket.incidentId === incident.id) continue;
    const updated = await deps.db.updateTicket(ticket.id, {
      incidentId: incident.id,
      updatedAt: now.toISOString(),
    });
    if (updated) linkedTicketIds.push(ticket.id);
  }

  const finalSize = created ? size : incident.size + linkedTicketIds.length;
  const saved = await deps.db.updateIncident(incident.id, { size: finalSize });
  incident = saved ?? { ...incident, size: finalSize };

  if (created) {
    await publishOpened(deps, incident, finalSize);
    await notifyDuty(deps, incident, finalSize);
  }

  return {
    incident,
    size: finalSize,
    reason: buildReason(target, similar.length, signals.length, finalSize, windowMinutes),
    created,
    linkedTicketIds,
  };
}
