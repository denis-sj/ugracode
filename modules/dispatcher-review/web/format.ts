import type { FieldDef, FieldGroup, PriorityLevel, Ticket, TicketField, TicketStatus } from '@ugra/contracts';

/** Чистые функции очереди и карточки заявки: фильтры, группировка полей, цитаты, журнал. */

export type UiTone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger' | 'info' | 'emergency' | 'critical' | 'high' | 'medium' | 'low' | 'muted';

export const STATUS_LABELS: Record<TicketStatus, string> = {
  new: 'Новая',
  ai_draft: 'Разбор ИИ',
  waiting_applicant: 'Ждёт ответа',
  in_review: 'На проверке',
  assigned: 'Назначена',
  in_progress: 'В работе',
  resolved: 'Решена',
  closed: 'Закрыта',
  cancelled: 'Отменена',
};

export const PRIORITY_LABELS: Record<PriorityLevel, string> = {
  emergency: 'Авария',
  critical: 'Критический',
  high: 'Высокий',
  medium: 'Средний',
  low: 'Низкий',
};

export const FIELD_GROUP_ORDER: readonly FieldGroup[] = ['classification', 'location', 'equipment', 'technical', 'symptoms'];

export const FIELD_GROUP_LABELS: Record<FieldGroup, string> = {
  classification: 'Классификация',
  location: 'Место',
  equipment: 'Оборудование',
  technical: 'Технические данные',
  symptoms: 'Симптомы',
};

export function statusTone(status: TicketStatus): UiTone {
  switch (status) {
    case 'in_review':
    case 'waiting_applicant':
      return 'warn';
    case 'assigned':
    case 'in_progress':
      return 'accent';
    case 'resolved':
    case 'closed':
      return 'ok';
    case 'cancelled':
      return 'muted';
    default:
      return 'neutral';
  }
}

export function priorityTone(priority: PriorityLevel | null): UiTone {
  return priority ?? 'neutral';
}

export interface TicketFilters {
  status: TicketStatus | 'all';
  onlyEmergency: boolean;
  query: string;
}

export const DEFAULT_FILTERS: TicketFilters = { status: 'all', onlyEmergency: false, query: '' };

/** Фильтр очереди: статус, аварийность и поиск по номеру или категории. */
export function filterTickets(tickets: readonly Ticket[], filters: TicketFilters): Ticket[] {
  const query = filters.query.trim().toLowerCase();
  return tickets.filter((ticket) => {
    if (filters.status !== 'all' && ticket.status !== filters.status) return false;
    if (filters.onlyEmergency && !ticket.isEmergency) return false;
    if (query !== '') {
      const haystack = `${ticket.number} ${ticket.category ?? ''}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

export interface ReviewField {
  key: string;
  label: string;
  group: FieldGroup;
  field: TicketField | null;
  value: string | null;
  order: number;
}

export interface ReviewGroup {
  group: FieldGroup;
  label: string;
  fields: ReviewField[];
}

/**
 * Поля по группам реестра `/api/meta`. Внутри группы сначала «на проверку»,
 * затем — по возрастанию уверенности: диспетчер видит сомнительное первым.
 */
export function groupTicketFields(fields: readonly TicketField[], defs: readonly FieldDef[]): ReviewGroup[] {
  const byKey = new Map(fields.map((field) => [field.fieldKey, field]));
  const groups = new Map<FieldGroup, ReviewField[]>();

  defs.forEach((def, index) => {
    const field = byKey.get(def.key) ?? null;
    const value = field?.value === null || field?.value === undefined ? null : String(field.value);
    const entry: ReviewField = {
      key: def.key,
      label: def.label,
      group: def.group,
      field,
      value,
      order: index,
    };
    const bucket = groups.get(def.group) ?? [];
    bucket.push(entry);
    groups.set(def.group, bucket);
  });

  return FIELD_GROUP_ORDER.filter((group) => (groups.get(group)?.length ?? 0) > 0).map((group) => ({
    group,
    label: FIELD_GROUP_LABELS[group],
    fields: (groups.get(group) ?? []).sort((left, right) => {
      const leftReview = left.field?.needsReview ? 0 : 1;
      const rightReview = right.field?.needsReview ? 0 : 1;
      return leftReview - rightReview || (left.field?.confidence ?? 1) - (right.field?.confidence ?? 1) || left.order - right.order;
    }),
  }));
}

/** Корпус и кабинет из полей заявки — для строки очереди. */
export function extractLocation(fields: readonly TicketField[] | null | undefined): {
  building: string | null;
  cabinet: string | null;
} {
  const read = (key: string): string | null => {
    const field = fields?.find((entry) => entry.fieldKey === key);
    if (!field || field.value === null || `${field.value}`.trim() === '') return null;
    return String(field.value);
  };
  return { building: read('building'), cabinet: read('cabinet') };
}

/** Текст «почему такой приоритет» — из полей и признака аварии. */
export function priorityReason(
  ticket: Ticket,
  fields: readonly TicketField[],
  resolve: (key: string, value: string) => string = (_key, value) => value,
): string {
  if (ticket.isEmergency) {
    return 'Сработал признак аварии: приоритет «Авария», уведомление дежурному уходит сразу, диспетчер только подтверждает.';
  }
  const read = (key: string): string | null => {
    const field = fields.find((entry) => entry.fieldKey === key);
    if (!field || field.value === null || `${field.value}`.trim() === '') return null;
    return String(field.value);
  };
  const impact = read('impact');
  const urgency = read('urgency');
  const parts: string[] = [];
  if (impact) parts.push(`влияние — ${resolve('impact', impact)}`);
  if (urgency) parts.push(`срочность — ${resolve('urgency', urgency)}`);
  if (parts.length > 0) return `Матрица «влияние × срочность»: ${parts.join(', ')}.`;
  return 'Приоритет посчитан правилом матрицы; диспетчер может изменить его при подтверждении.';
}

export interface TextSegment {
  text: string;
  quote: boolean;
}

/** Подсветка цитат ИИ в оригинале обращения (регистр и порядок не важны). */
export function highlightQuotes(text: string, quotes: ReadonlyArray<string | null | undefined>): TextSegment[] {
  const normalized = [...new Set(quotes.map((quote) => quote?.trim().toLowerCase() ?? ''))]
    .filter((quote) => quote.length >= 3)
    .sort((left, right) => right.length - left.length);

  if (text === '') return [];
  if (normalized.length === 0) return [{ text, quote: false }];

  const lower = text.toLowerCase();
  const ranges: Array<{ start: number; end: number }> = [];
  for (const quote of normalized) {
    let index = lower.indexOf(quote);
    while (index !== -1) {
      ranges.push({ start: index, end: index + quote.length });
      index = lower.indexOf(quote, index + quote.length);
    }
  }
  if (ranges.length === 0) return [{ text, quote: false }];

  ranges.sort((left, right) => left.start - right.start || right.end - left.end);
  const merged: Array<{ start: number; end: number }> = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }

  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const range of merged) {
    if (range.start > cursor) segments.push({ text: text.slice(cursor, range.start), quote: false });
    segments.push({ text: text.slice(range.start, range.end), quote: true });
    cursor = range.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), quote: false });
  return segments;
}

const EVENT_TITLES: Record<string, string> = {
  'appeal.created': 'Обращение создано',
  'analysis.started': 'Разбор запущен',
  'analysis.step.completed': 'Шаг разбора выполнен',
  'analysis.completed': 'Разбор завершён',
  'ticket.field.set': 'Поле заполнено',
  'ticket.field.corrected': 'Поле исправлено человеком',
  'ticket.confirmed': 'Заявка подтверждена',
  'ticket.assigned': 'Назначен исполнитель',
  'ticket.status.changed': 'Статус изменён',
  'ticket.deadline.extended': 'Срок продлён',
  'ticket.returned': 'Заявка возвращена диспетчеру',
  'message.sent': 'Сообщение заявителю',
  'setting.changed': 'Настройка изменена',
  'emergency.detected': 'Обнаружены признаки аварии',
};

export function eventTitle(type: string): string {
  return EVENT_TITLES[type] ?? type;
}

function eventTone(type: string): UiTone {
  if (type === 'emergency.detected') return 'danger';
  if (type === 'ticket.field.corrected' || type === 'ticket.returned') return 'warn';
  if (type === 'ticket.confirmed' || type === 'ticket.assigned' || type === 'analysis.completed') return 'ok';
  if (type.startsWith('analysis.')) return 'accent';
  if (type === 'ticket.status.changed') return 'info';
  return 'neutral';
}

export interface EventItem {
  id: string;
  title: string;
  description?: string;
  at?: string;
  tone: UiTone;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function payloadSummary(payload: Record<string, unknown>): string | undefined {
  if (typeof payload.stepId === 'string') return payload.stepId;
  if (typeof payload.assigneeId === 'string') return `исполнитель: ${payload.assigneeId}`;
  if (typeof payload.fieldKey === 'string') {
    const value = payload.value;
    return typeof value === 'string' || typeof value === 'number' ? `${payload.fieldKey}: ${value}` : payload.fieldKey;
  }
  if (typeof payload.to === 'string') return `→ ${payload.to}`;
  if (typeof payload.status === 'string') return `статус: ${payload.status}`;
  if (typeof payload.key === 'string') return payload.key;
  return undefined;
}

/** Журнал действий заявки → элементы Timeline. Неизвестные события показываем как есть. */
export function toTimelineItems(events: readonly unknown[]): EventItem[] {
  return events.map((raw, index) => {
    if (!isRecord(raw)) return { id: `event-${index}`, title: 'Событие', tone: 'neutral' };
    const type = typeof raw.type === 'string' ? raw.type : 'event';
    const payload = isRecord(raw.payload) ? raw.payload : {};
    const actorKind = isRecord(raw.actor) && typeof raw.actor.kind === 'string' ? raw.actor.kind : '';
    const actorLabel = actorKind === 'ai' ? 'ИИ' : actorKind === 'user' ? 'Человек' : actorKind === 'system' ? 'Система' : '';
    const detail = payloadSummary(payload);
    const description = [actorLabel, detail].filter(Boolean).join(' · ');
    return {
      id: typeof raw.id === 'string' ? raw.id : `event-${index}`,
      title: eventTitle(type),
      description: description === '' ? undefined : description,
      at: typeof raw.at === 'string' ? raw.at : undefined,
      tone: eventTone(type),
    };
  });
}
