import type { FieldDef, Ticket, TicketField } from '@ugra/contracts';
import { isSuspicious } from './format';
import type { QueueSignals } from './format';

/**
 * Смысловые группы очереди (вариант A макета): решение → подтверждение → у инженеров.
 * Группировка — чистая функция без React: её же проверяют тесты.
 */
export interface QueueGroups {
  /** ИИ сомневается в полях — диспетчер проверяет и правит. */
  decision: Ticket[];
  /** ИИ уверен, исполнитель уже предложен — можно подтверждать. */
  ready: Ticket[];
  /** Назначены инженеру или уже в работе. */
  withEngineer: Ticket[];
  /** Ждут ответа заявителя. */
  waitingApplicant: Ticket[];
  /** Новые заявки, которые ИИ ещё разбирает. */
  drafting: Ticket[];
}

/** Статусы, в которых заявка ещё не попала в работу диспетчера. */
const DRAFTING_STATUSES: ReadonlySet<Ticket['status']> = new Set(['new', 'ai_draft']);

/** Авария, которая держится на экране: закрытые и отменённые не считаются. */
const ACTIVE_EMERGENCY_STATUSES: ReadonlySet<Ticket['status']> = new Set([
  'new',
  'ai_draft',
  'waiting_applicant',
  'in_review',
  'assigned',
  'in_progress',
]);

export function emptyGroups(): QueueGroups {
  return { decision: [], ready: [], withEngineer: [], waitingApplicant: [], drafting: [] };
}

/**
 * Готова ли заявка к подтверждению одним нажатием: ИИ не сомневается ни в одном поле.
 * Пока сигналов нет (детали ещё грузятся), заявка считается спорной — подтверждать вслепую нельзя.
 */
export function isReadyTicket(ticket: Ticket, signals: QueueSignals | undefined): boolean {
  return (
    ticket.status === 'in_review' && !ticket.isEmergency && signals !== undefined && !isSuspicious(signals)
  );
}

/** Раскладывает уже отфильтрованную и отсортированную очередь по смысловым группам. */
export function groupTickets(
  tickets: readonly Ticket[],
  signalsOf: Record<string, QueueSignals>,
): QueueGroups {
  const groups = emptyGroups();
  for (const ticket of tickets) {
    if (ticket.status === 'in_review') {
      const target = isReadyTicket(ticket, signalsOf[ticket.id]) ? groups.ready : groups.decision;
      target.push(ticket);
      continue;
    }
    if (ticket.status === 'assigned' || ticket.status === 'in_progress') {
      groups.withEngineer.push(ticket);
      continue;
    }
    if (ticket.status === 'waiting_applicant') {
      groups.waitingApplicant.push(ticket);
      continue;
    }
    if (DRAFTING_STATUSES.has(ticket.status)) groups.drafting.push(ticket);
  }
  return groups;
}

/** Сколько всего заявок в группах — для пустого состояния. */
export function queueSize(groups: QueueGroups): number {
  return (
    groups.decision.length +
    groups.ready.length +
    groups.withEngineer.length +
    groups.waitingApplicant.length +
    groups.drafting.length
  );
}

/**
 * Раскладка очереди по доске: три колонки с решением и одна свёрнутая полоса.
 * Авария показывается только в колонке «Аварии» — даже если она ещё на проверке
 * или ждёт заявителя, чтобы не дублировать карточку на экране.
 */
export interface QueueBoard {
  /** Все активные аварии — красная тема экрана. */
  emergencies: Ticket[];
  /** ИИ сомневается в полях: нужно решение диспетчера. */
  decision: Ticket[];
  /** ИИ уверен, исполнитель предложен: можно подтверждать. */
  ready: Ticket[];
  /** Уже у инженера. */
  withEngineer: Ticket[];
  /** Ждут ответа заявителя. */
  waitingApplicant: Ticket[];
  /** Новые заявки, которые ИИ ещё разбирает. */
  drafting: Ticket[];
}

export function emptyBoard(): QueueBoard {
  return {
    emergencies: [],
    decision: [],
    ready: [],
    withEngineer: [],
    waitingApplicant: [],
    drafting: [],
  };
}

/** Раскладывает уже отфильтрованную и отсортированную очередь по колонкам доски. */
export function boardTickets(
  tickets: readonly Ticket[],
  signalsOf: Record<string, QueueSignals>,
): QueueBoard {
  const board = emptyBoard();
  for (const ticket of tickets) {
    if (ticket.isEmergency) {
      board.emergencies.push(ticket);
      continue;
    }
    if (ticket.status === 'in_review') {
      const target = isReadyTicket(ticket, signalsOf[ticket.id]) ? board.ready : board.decision;
      target.push(ticket);
      continue;
    }
    if (ticket.status === 'assigned' || ticket.status === 'in_progress') {
      board.withEngineer.push(ticket);
      continue;
    }
    if (ticket.status === 'waiting_applicant') {
      board.waitingApplicant.push(ticket);
      continue;
    }
    if (DRAFTING_STATUSES.has(ticket.status)) board.drafting.push(ticket);
  }
  return board;
}

/** Сколько всего заявок на доске — для пустого состояния экрана. */
export function boardSize(board: QueueBoard): number {
  return (
    board.emergencies.length +
    board.decision.length +
    board.ready.length +
    board.withEngineer.length +
    board.waitingApplicant.length +
    board.drafting.length
  );
}

/** Первая активная авария для закреплённой полосы; порядок берём из уже отсортированной очереди. */
export function featuredEmergency(tickets: readonly Ticket[]): Ticket | null {
  return tickets.find((ticket) => ticket.isEmergency && ACTIVE_EMERGENCY_STATUSES.has(ticket.status)) ?? null;
}

/**
 * Человеческие подписи полей, в которых ИИ сомневается: `['категория', 'срочность']`.
 * Служебные коды (`serviceType`) на экран не попадают — поле без подписи пропускаем.
 */
export function unclearFieldLabels(
  fields: readonly TicketField[],
  defs: readonly FieldDef[],
  limit = 2,
): string[] {
  const labels: string[] = [];
  for (const field of fields) {
    if (!field.needsReview) continue;
    const label = defs.find((def) => def.key === field.fieldKey)?.label;
    if (!label) continue;
    labels.push(label.charAt(0).toLocaleLowerCase('ru') + label.slice(1));
    if (labels.length >= limit) break;
  }
  return labels;
}

/** «Не ясно: категория, срочность» — одна строка причины, почему нужен диспетчер. */
export function unclearNote(
  fields: readonly TicketField[] | null | undefined,
  defs: readonly FieldDef[],
  limit = 2,
): string | null {
  const labels = unclearFieldLabels(fields ?? [], defs, limit);
  return labels.length === 0 ? null : `Не ясно: ${labels.join(', ')}`;
}
