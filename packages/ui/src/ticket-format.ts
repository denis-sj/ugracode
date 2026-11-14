import type { TicketStatus } from '@ugra/contracts';
import type { BadgeTone } from './types';

/** Подписи статусов заявки — одинаковые в чате, «Моих заявках» и истории. */
const STATUS_META: Record<TicketStatus, { label: string; tone: BadgeTone }> = {
  new: { label: 'Новая', tone: 'neutral' },
  ai_draft: { label: 'Черновик ИИ', tone: 'muted' },
  waiting_applicant: { label: 'Ждём ответа', tone: 'accent' },
  in_review: { label: 'На проверке', tone: 'info' },
  assigned: { label: 'Назначена', tone: 'info' },
  in_progress: { label: 'В работе', tone: 'info' },
  resolved: { label: 'Подтвердите выполнение', tone: 'warn' },
  closed: { label: 'Закрыта', tone: 'ok' },
  cancelled: { label: 'Отменена', tone: 'muted' },
};

export function formatTicketStatus(status: TicketStatus): string {
  return STATUS_META[status].label;
}

export function ticketStatusTone(status: TicketStatus): BadgeTone {
  return STATUS_META[status].tone;
}

/** Шкала «Собрана → Проверена → Назначена → Выполнена»: сколько сегментов закрашено (0…4). */
export const TICKET_STAGES = ['Собрана', 'Проверена', 'Назначена', 'Выполнена'] as const;

const STAGE_BY_STATUS: Record<TicketStatus, number> = {
  new: 1,
  ai_draft: 1,
  waiting_applicant: 1,
  in_review: 1,
  assigned: 2,
  in_progress: 3,
  resolved: 4,
  closed: 4,
  cancelled: 0,
};

export function ticketStage(status: TicketStatus): number {
  return STAGE_BY_STATUS[status];
}

export function isActiveStatus(status: TicketStatus): boolean {
  return status !== 'closed' && status !== 'cancelled';
}

const MONTHS_SHORT = [
  'янв.',
  'февр.',
  'мар.',
  'апр.',
  'мая',
  'июн.',
  'июл.',
  'авг.',
  'сент.',
  'окт.',
  'нояб.',
  'дек.',
] as const;

function isValidDate(value: Date): boolean {
  return !Number.isNaN(value.getTime());
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function timeOf(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Разница календарных дней между локальными датами (0 — сегодня, 1 — завтра). */
function calendarDayDiff(from: Date, to: Date): number {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  return Math.round((end - start) / 86_400_000);
}

function parseDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return isValidDate(date) ? date : null;
}

/** «12 нояб.» */
export function formatDayMonth(iso: string | null | undefined): string {
  const date = parseDate(iso);
  if (!date) return '—';
  return `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`;
}

/** Дата и время: «12 нояб., 14:30». */
export function formatDayTime(iso: string | null | undefined): string {
  const date = parseDate(iso);
  if (!date) return '—';
  return `${formatDayMonth(iso)}, ${timeOf(date)}`;
}

/** Срок: «сегодня до 14:30», «завтра до 12:00», «18 нояб. до 09:00». */
export function formatDue(iso: string | null | undefined, now: Date = new Date()): string {
  const date = parseDate(iso);
  if (!date) return '—';
  const diff = calendarDayDiff(now, date);
  if (diff === 0) return `сегодня до ${timeOf(date)}`;
  if (diff === 1) return `завтра до ${timeOf(date)}`;
  if (diff === -1) return `вчера до ${timeOf(date)}`;
  return `${formatDayMonth(iso)} до ${timeOf(date)}`;
}

export interface HistoryTicket {
  status: TicketStatus;
  createdAt: string;
  updatedAt?: string;
}

export interface HistoryGroups<T extends HistoryTicket> {
  active: T[];
  closed: T[];
}

/**
 * Группировка истории обращений: активные — всё, что не закрыто и не отменено; остальное — «Ранее».
 * Внутри групп свежие сверху. Пустой список даёт две пустые группы.
 */
export function groupHistory<T extends HistoryTicket>(tickets: readonly T[]): HistoryGroups<T> {
  const active: T[] = [];
  const closed: T[] = [];
  for (const ticket of tickets) {
    if (isActiveStatus(ticket.status)) active.push(ticket);
    else closed.push(ticket);
  }
  const byRecent = (left: T, right: T): number => {
    const leftAt = new Date(left.updatedAt ?? left.createdAt).getTime();
    const rightAt = new Date(right.updatedAt ?? right.createdAt).getTime();
    return rightAt - leftAt;
  };
  active.sort(byRecent);
  closed.sort(byRecent);
  return { active, closed };
}
