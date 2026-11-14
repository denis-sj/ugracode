import type { FieldDef, FieldGroup, PriorityLevel, Ticket, TicketField, TicketStatus } from '@ugra/contracts';

/**
 * Чистые функции очереди и карточки заявки: фильтры, сортировка, сроки по регламенту,
 * группировка полей, цитаты, журнал «ИИ предложил → человек исправил», возврат инженером.
 */

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

export type QueueBucket = 'all' | 'suspicious' | 'ready' | 'emergency';

export interface TicketFilters {
  status: TicketStatus | 'all';
  onlyEmergency: boolean;
  query: string;
  /** Быстрый фильтр очереди: все / сомнительные / готовые / аварии. */
  bucket: QueueBucket;
  /** Исполнитель из query дашборда: `#/queue?assignee=u-1`. */
  assignee: string;
}

export const DEFAULT_FILTERS: TicketFilters = {
  status: 'all',
  onlyEmergency: false,
  query: '',
  bucket: 'all',
  assignee: '',
};

export interface QueueSignals {
  /** Сколько полей помечено «на проверку». */
  review: number;
  /** Минимальная уверенность по заполненным полям; null — полей нет. */
  confidence: number | null;
}

export interface FilterContext {
  signals?: Record<string, QueueSignals>;
  /** Готовое «корпус · кабинет 312» для поиска по месту. */
  locations?: Record<string, string>;
}

function confidenceOf(fields: readonly TicketField[]): number | null {
  const values = fields
    .filter((field) => field.value !== null && String(field.value).trim() !== '')
    .map((field) => field.confidence)
    .filter((value) => Number.isFinite(value));
  return values.length === 0 ? null : Math.min(...values);
}

/** Уверенность заявки — по самому слабому заполненному полю; спорные поля считаются отдельно. */
export function ticketSignals(fields: readonly TicketField[]): QueueSignals {
  return {
    review: fields.filter((field) => field.needsReview).length,
    confidence: confidenceOf(fields),
  };
}

export const CONFIDENCE_THRESHOLD = 0.75;

export function isSuspicious(signals: QueueSignals | undefined): boolean {
  if (!signals) return false;
  return signals.review > 0 || (signals.confidence !== null && signals.confidence < CONFIDENCE_THRESHOLD);
}

function matchesBucket(ticket: Ticket, filters: TicketFilters, context: FilterContext): boolean {
  if (filters.bucket === 'all') return true;
  const signals = context.signals?.[ticket.id];
  if (filters.bucket === 'emergency') return ticket.isEmergency;
  if (filters.bucket === 'ready') {
    return (
      ticket.status === 'in_review' &&
      !ticket.isEmergency &&
      signals !== undefined &&
      !isSuspicious(signals)
    );
  }
  return isSuspicious(signals);
}

/** Закрытые и решённые не показываем в очереди, пока статус не выбран явно. */
const ARCHIVE_STATUSES = new Set<TicketStatus>(['closed', 'cancelled', 'resolved']);

/** Фильтр очереди: статус, аварийность, исполнитель, быстрый фильтр и поиск по номеру/категории/месту. */
export function filterTickets(
  tickets: readonly Ticket[],
  filters: TicketFilters,
  context: FilterContext = {},
): Ticket[] {
  const query = filters.query.trim().toLowerCase();
  return tickets.filter((ticket) => {
    if (filters.status !== 'all') {
      if (ticket.status !== filters.status) return false;
    } else if (ARCHIVE_STATUSES.has(ticket.status)) {
      return false;
    }
    if (filters.onlyEmergency && !ticket.isEmergency) return false;
    if (filters.assignee !== '' && ticket.assigneeId !== filters.assignee) return false;
    if (!matchesBucket(ticket, filters, context)) return false;
    if (query !== '') {
      const haystack = `${ticket.number} ${ticket.category ?? ''} ${context.locations?.[ticket.id] ?? ''}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

/** Новые строки временно поднимаем наверх — «въезжают» над остальной очередью. */
export function promoteNew(tickets: readonly Ticket[], newIds: ReadonlySet<string>): Ticket[] {
  if (newIds.size === 0) return [...tickets];
  const fresh = tickets.filter((ticket) => newIds.has(ticket.id));
  const rest = tickets.filter((ticket) => !newIds.has(ticket.id));
  return [...fresh, ...rest];
}

function sameLocalDay(iso: string, now: number): boolean {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return false;
  const current = new Date(now);
  return (
    date.getFullYear() === current.getFullYear() &&
    date.getMonth() === current.getMonth() &&
    date.getDate() === current.getDate()
  );
}

export interface QueueSummary {
  review: number;
  waiting: number;
  emergency: number;
  perShift: number;
}

/** Сводка очереди: ждут проверки, ждут заявителя, аварии, за смену (созданы сегодня). */
export function queueSummary(tickets: readonly Ticket[], now: number): QueueSummary {
  return {
    review: tickets.filter((ticket) => ticket.status === 'in_review').length,
    waiting: tickets.filter((ticket) => ticket.status === 'waiting_applicant').length,
    emergency: tickets.filter((ticket) => ticket.isEmergency && !ARCHIVE_STATUSES.has(ticket.status)).length,
    perShift: tickets.filter((ticket) => sameLocalDay(ticket.createdAt, now)).length,
  };
}

/** «Сколько ждёт»: от создания до сейчас. */
export function waitingLabel(createdAt: string, now: number): string {
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) return '—';
  return formatDuration(Math.max(0, now - created));
}

function pluralFields(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'поле';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'поля';
  return 'полей';
}

export interface QueueAction {
  text: string;
  tone: UiTone;
}

/** «Что сделать» в строке очереди — одна короткая фраза с точкой-статусом. */
export function queueAction(ticket: Ticket, signals: QueueSignals | undefined): QueueAction {
  if (ticket.isEmergency) return { text: 'Авария · дежурный уведомлён', tone: 'danger' };
  if (ticket.status === 'waiting_applicant') return { text: 'Ждёт ответа заявителя', tone: 'info' };
  if (ticket.status === 'in_review') {
    if (signals === undefined) return { text: 'Проверить поля', tone: 'warn' };
    if (signals.review > 0) {
      return { text: `Проверить ${signals.review} ${pluralFields(signals.review)}`, tone: 'warn' };
    }
    if (isSuspicious(signals)) return { text: 'Проверить сомнительные поля', tone: 'warn' };
    return { text: 'Готова к подтверждению', tone: 'ok' };
  }
  if (ticket.status === 'assigned') return { text: 'Назначена · ждёт инженера', tone: 'accent' };
  if (ticket.status === 'in_progress') return { text: 'В работе', tone: 'accent' };
  if (ticket.status === 'resolved') return { text: 'Ждёт подтверждения заявителя', tone: 'warn' };
  if (ticket.status === 'closed') return { text: 'Закрыта', tone: 'muted' };
  if (ticket.status === 'cancelled') return { text: 'Отменена', tone: 'muted' };
  return { text: 'Разбирается', tone: 'neutral' };
}

/** Заголовок заявки из полей: симптом → объект → категория → «Обращение». */
export function ticketTitleFromFields(
  fields: readonly TicketField[],
  resolve: (key: string, value: string) => string = (_key, value) => value,
): string {
  const read = (key: string): string | null => {
    const field = fields.find((entry) => entry.fieldKey === key);
    if (!field || field.value === null || `${field.value}`.trim() === '') return null;
    return String(field.value);
  };
  const title = read('symptoms') ?? read('object') ?? read('category');
  if (!title) return 'Обращение';
  const resolved = read('symptoms') || read('object') ? title : resolve('category', title);
  const capitalized = resolved.charAt(0).toUpperCase() + resolved.slice(1);
  return capitalized.length > 80 ? `${capitalized.slice(0, 78)}…` : capitalized;
}

/** «Корпус Б · кабинет 312» для превью и поиска. */
export function formatLocation(
  location: { building: string | null; cabinet: string | null } | undefined,
  resolveBuilding: (code: string) => string = (code) => code,
): string {
  if (!location) return 'место уточняется';
  const parts: string[] = [];
  if (location.building) parts.push(resolveBuilding(location.building));
  if (location.cabinet) parts.push(`кабинет ${location.cabinet}`);
  return parts.length === 0 ? 'место уточняется' : parts.join(' · ');
}

/* ---------- Query из hash: очередь и проверка ---------- */

const STATUS_VALUES = new Set<string>([
  'new',
  'ai_draft',
  'waiting_applicant',
  'in_review',
  'assigned',
  'in_progress',
  'resolved',
  'closed',
  'cancelled',
]);

/** `#/queue?status=in_review&emergency=true&assignee=u-1` → начальные фильтры. */
export function queueFiltersFromQuery(query: URLSearchParams): TicketFilters {
  const status = query.get('status') ?? '';
  const emergency = query.get('emergency');
  return {
    ...DEFAULT_FILTERS,
    status: STATUS_VALUES.has(status) ? (status as TicketStatus) : 'all',
    onlyEmergency: emergency === 'true' || emergency === '1',
    assignee: (query.get('assignee') ?? '').trim(),
  };
}

/** `#/review?id=…` → id заявки; пустая строка и мусор дают null. */
export function reviewTicketId(query: URLSearchParams): string | null {
  const id = (query.get('id') ?? '').trim();
  return id === '' ? null : id;
}

export function reviewHref(ticketId: string): string {
  return `/review?id=${encodeURIComponent(ticketId)}`;
}

export type QueueEventKind = 'new' | 'updated' | 'ignored';

/**
 * Событие `GET /api/events/stream` → что делать очереди.
 * Есть `ticketId`: неизвестный — новая заявка, известный — изменилась.
 * Без `ticketId` (например, `appeal.created`) — очередь не трогаем, заявка придёт своим событием.
 */
export function queueEventAction(raw: unknown, knownIds: ReadonlySet<string>): QueueEventKind {
  if (!isRecord(raw)) return 'ignored';
  const ticketId = raw.ticketId;
  if (typeof ticketId !== 'string' || ticketId === '') return 'ignored';
  return knownIds.has(ticketId) ? 'updated' : 'new';
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

const LOCATION_BUILDING: Record<string, string> = { a: 'А', b: 'Б', v: 'В', prom: 'ПРОМ' };

/** Место для seeded-заявок: поля могут быть пустыми, но `locationId` = `cab-b-312`. */
export function locationFromTicket(
  ticket: Pick<Ticket, 'locationId'>,
  fields: readonly TicketField[] | null | undefined,
): { building: string | null; cabinet: string | null } {
  const fromFields = extractLocation(fields);
  if (fromFields.building && fromFields.cabinet) return fromFields;
  const match = /^cab-([a-zа-яё]+)-(\d+)$/i.exec(ticket.locationId ?? '');
  const code = match?.[1]?.toLowerCase() ?? '';
  const building = code === '' ? null : (LOCATION_BUILDING[code] ?? code.toUpperCase());
  return {
    building: fromFields.building ?? building,
    cabinet: fromFields.cabinet ?? match?.[2] ?? null,
  };
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

/* ---------- Сортировка очереди: аварии и критические сверху ---------- */

const PRIORITY_ORDER: Record<PriorityLevel, number> = { emergency: 0, critical: 1, high: 2, medium: 3, low: 4 };
const NO_PRIORITY = 5;

/** Место заявки в очереди: авария — 0, критическая — 1, дальше по убыванию важности. */
export function priorityRank(ticket: Pick<Ticket, 'priority' | 'isEmergency'>): number {
  if (ticket.isEmergency) return 0;
  return ticket.priority === null ? NO_PRIORITY : PRIORITY_ORDER[ticket.priority];
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

function compareNumbers(left: number, right: number): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** Ближайший срок заявки (реакция или решение). Заявки без срока — в конце очереди. */
export function ticketDueTime(ticket: Pick<Ticket, 'reactDueAt' | 'slaDueAt'>): number {
  const times = [parseTime(ticket.reactDueAt), parseTime(ticket.slaDueAt)].filter(
    (time): time is number => time !== null,
  );
  return times.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...times);
}

/**
 * Очередь диспетчера: аварии и критические сверху, внутри уровня — по ближайшему сроку
 * регламента, затем по времени создания (старые раньше). Исходный массив не меняется.
 */
export function sortTickets(tickets: readonly Ticket[]): Ticket[] {
  return [...tickets].sort((left, right) => {
    const byPriority = compareNumbers(priorityRank(left), priorityRank(right));
    if (byPriority !== 0) return byPriority;
    const byDue = compareNumbers(ticketDueTime(left), ticketDueTime(right));
    if (byDue !== 0) return byDue;
    const byCreated = compareNumbers(
      parseTime(left.createdAt) ?? Number.POSITIVE_INFINITY,
      parseTime(right.createdAt) ?? Number.POSITIVE_INFINITY,
    );
    if (byCreated !== 0) return byCreated;
    return left.number.localeCompare(right.number);
  });
}

/* ---------- Сроки регламента: реакция и решение ---------- */

export type DeadlineKind = 'react' | 'sla';
export type DeadlineTone = 'neutral' | 'warn' | 'danger';

export interface Deadline {
  kind: DeadlineKind;
  /** «реакция» или «решение» — для плашки в интерфейсе. */
  label: string;
  dueAt: string;
  dueTime: number;
  /** «12 мин» или «просрочено 12 мин». */
  text: string;
  overdue: boolean;
  /** Сколько минут осталось (или на сколько просрочено) — по модулю. */
  minutes: number;
  tone: DeadlineTone;
}

const REACT_LABEL = 'реакция';
const SLA_LABEL = 'решение';
const WARN_BEFORE_MS = 15 * 60_000;

/** Человеческая длительность: «< 1 мин», «12 мин», «2 ч 5 мин», «3 д 4 ч». */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  const total = Math.abs(ms);
  if (total < 60_000) return '< 1 мин';
  const totalMinutes = Math.floor(total / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return hours > 0 ? `${days} д ${hours} ч` : `${days} д`;
  if (hours > 0) return minutes > 0 ? `${hours} ч ${minutes} мин` : `${hours} ч`;
  return `${minutes} мин`;
}

/** Один срок заявки. Нет даты или она битая — срока нет (не рисуем «просрочено на NaN»). */
export function deadline(kind: DeadlineKind, dueAt: string | null | undefined, now: number): Deadline | null {
  const dueTime = parseTime(dueAt);
  if (dueTime === null || !dueAt) return null;
  const left = dueTime - now;
  const overdue = left < 0;
  const tone: DeadlineTone = overdue ? 'danger' : left <= WARN_BEFORE_MS ? 'warn' : 'neutral';
  return {
    kind,
    label: kind === 'react' ? REACT_LABEL : SLA_LABEL,
    dueAt,
    dueTime,
    text: overdue ? `просрочено ${formatDuration(left)}` : formatDuration(left),
    overdue,
    minutes: Math.round(Math.abs(left) / 60_000),
    tone,
  };
}

/** Оба срока заявки, если сервер их посчитал: сначала реакция, затем решение. */
export function ticketDeadlines(ticket: Pick<Ticket, 'reactDueAt' | 'slaDueAt'>, now: number): Deadline[] {
  return [deadline('react', ticket.reactDueAt, now), deadline('sla', ticket.slaDueAt, now)].filter(
    (item): item is Deadline => item !== null,
  );
}

/** Сколько заявок просрочено — для сводки очереди. */
export function overdueCount(tickets: readonly Ticket[], now: number): number {
  return tickets.filter((ticket) => ticketDeadlines(ticket, now).some((item) => item.overdue)).length;
}

/* ---------- Журнал: «ИИ предложил → человек исправил» ---------- */

export interface DiffSegment {
  text: string;
  /** Фрагмент, которого не было в другом варианте. */
  changed: boolean;
}

export interface ValueDiff {
  before: DiffSegment[];
  after: DiffSegment[];
  changed: boolean;
}

const WHITESPACE = /^\s+$/;

function tokenize(text: string): string[] {
  return text.split(/(\s+)/).filter((token) => token !== '');
}

function mark(token: string, changed: boolean): DiffSegment {
  return { text: token, changed: changed && !WHITESPACE.test(token) };
}

function pushSegment(target: DiffSegment[], segment: DiffSegment): void {
  const last = target[target.length - 1];
  if (last && last.changed === segment.changed) {
    last.text += segment.text;
    return;
  }
  target.push(segment);
}

/**
 * Пословное сравнение «было → стало» для подсветки отличий в журнале.
 * Устойчиво к пустым значениям и лишним пробелам; исходные строки не меняются.
 */
export function diffValues(before: string | null, after: string | null): ValueDiff {
  const left = before === null ? [] : tokenize(before);
  const right = after === null ? [] : tokenize(after);

  if (left.join('') === right.join('')) {
    const same: DiffSegment[] = before === null ? [] : [mark(before, false)];
    return { before: same, after: before === null && after !== null ? [mark(after, false)] : same, changed: false };
  }

  // longest common subsequence по токенам: совпавшее не подсвечиваем
  const table: number[][] = Array.from({ length: left.length + 1 }, () => new Array<number>(right.length + 1).fill(0));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      const row = table[i];
      const nextRow = table[i + 1];
      if (!row || !nextRow) continue;
      row[j] = left[i] === right[j] ? (nextRow[j + 1] ?? 0) + 1 : Math.max(nextRow[j] ?? 0, row[j + 1] ?? 0);
    }
  }

  const segmentsBefore: DiffSegment[] = [];
  const segmentsAfter: DiffSegment[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      pushSegment(segmentsBefore, mark(left[i] ?? '', false));
      pushSegment(segmentsAfter, mark(right[j] ?? '', false));
      i += 1;
      j += 1;
      continue;
    }
    const down = table[i + 1]?.[j] ?? 0;
    const rightStep = table[i]?.[j + 1] ?? 0;
    if (down >= rightStep) {
      pushSegment(segmentsBefore, mark(left[i] ?? '', true));
      i += 1;
    } else {
      pushSegment(segmentsAfter, mark(right[j] ?? '', true));
      j += 1;
    }
  }
  while (i < left.length) {
    pushSegment(segmentsBefore, mark(left[i] ?? '', true));
    i += 1;
  }
  while (j < right.length) {
    pushSegment(segmentsAfter, mark(right[j] ?? '', true));
    j += 1;
  }

  return { before: segmentsBefore, after: segmentsAfter, changed: true };
}

export type JournalActor = 'ai' | 'user' | 'system' | 'unknown';

export interface JournalRow {
  id: string;
  /** Тип события ядра, например `ticket.field.corrected`. */
  type: string;
  title: string;
  tone: UiTone;
  at?: string;
  time: number;
  author: string;
  actorKind: JournalActor;
  fieldKey: string | null;
  fieldLabel: string | null;
  description?: string;
  /** Разница «ИИ предложил → человек исправил»; null, если правки не было. */
  diff: ValueDiff | null;
  reason?: string;
}

export interface JournalOptions {
  fieldLabel?: (key: string) => string | null;
  /** Приводит коды справочников к подписям до сравнения. */
  formatValue?: (key: string, value: string | null) => string | null;
  actorName?: (id: string | null) => string | null;
}

function readString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value;
  if (typeof value === 'number') return String(value);
  return null;
}

function actorOf(raw: Record<string, unknown>): { id: string | null; kind: JournalActor } {
  if (!isRecord(raw.actor)) return { id: null, kind: 'unknown' };
  const kind = raw.actor.kind;
  const normalized: JournalActor = kind === 'ai' || kind === 'user' || kind === 'system' ? kind : 'unknown';
  return { id: readString(raw.actor.id), kind: normalized };
}

const ACTOR_FALLBACK: Record<JournalActor, string> = {
  ai: 'ИИ',
  user: 'Человек',
  system: 'Система',
  unknown: 'Неизвестно',
};

function journalRow(raw: unknown, index: number, options: JournalOptions): JournalRow {
  if (!isRecord(raw)) {
    return {
      id: `event-${index}`,
      type: 'event',
      title: 'Событие',
      tone: 'neutral',
      time: 0,
      author: ACTOR_FALLBACK.unknown,
      actorKind: 'unknown',
      fieldKey: null,
      fieldLabel: null,
      diff: null,
    };
  }
  const type = typeof raw.type === 'string' ? raw.type : 'event';
  const payload = isRecord(raw.payload) ? raw.payload : {};
  const actor = actorOf(raw);
  const at = typeof raw.at === 'string' ? raw.at : undefined;
  const fieldKey = readString(payload.fieldKey);
  const format = (value: string | null): string | null =>
    value === null ? null : (options.formatValue?.(fieldKey ?? '', value) ?? value);
  const aiValue = format(readString(payload.previous) ?? readString(payload.aiValue));
  const humanValue = format(readString(payload.value));
  const diff =
    type === 'ticket.field.corrected' && (aiValue !== null || humanValue !== null)
      ? diffValues(aiValue, humanValue)
      : null;
  const reason = readString(payload.reason) ?? undefined;

  return {
    id: typeof raw.id === 'string' ? raw.id : `event-${index}`,
    type,
    title: eventTitle(type),
    tone: eventTone(type),
    at,
    time: parseTime(at) ?? 0,
    author: (actor.id ? options.actorName?.(actor.id) : null) ?? ACTOR_FALLBACK[actor.kind],
    actorKind: actor.kind,
    fieldKey,
    fieldLabel: fieldKey ? (options.fieldLabel?.(fieldKey) ?? fieldKey) : null,
    description: diff ? undefined : payloadSummary(payload),
    diff,
    reason,
  };
}

/** Журнал заявки: события новее — выше; правки несут разницу «ИИ → человек». */
export function journalRows(events: readonly unknown[], options: JournalOptions = {}): JournalRow[] {
  return events.map((raw, index) => journalRow(raw, index, options)).sort((left, right) => right.time - left.time);
}

export const JOURNAL_ALL = 'all';

export interface JournalTypeOption {
  type: string;
  title: string;
  count: number;
}

/** Типы событий, которые есть в журнале, — для фильтра. */
export function journalTypes(rows: readonly JournalRow[]): JournalTypeOption[] {
  const map = new Map<string, JournalTypeOption>();
  for (const row of rows) {
    const item = map.get(row.type);
    if (item) item.count += 1;
    else map.set(row.type, { type: row.type, title: row.title, count: 1 });
  }
  return [...map.values()].sort((left, right) => right.count - left.count || left.title.localeCompare(right.title));
}

/** Фильтр журнала по типу события; `all` — без фильтра. */
export function filterJournal(rows: readonly JournalRow[], type: string): JournalRow[] {
  if (type === JOURNAL_ALL) return [...rows];
  return rows.filter((row) => row.type === type);
}

/* ---------- Возврат инженером: плашка с причиной ---------- */

export interface ReturnInfo {
  at?: string;
  time: number;
  /** Причина возврата; null, если инженер её не указал. */
  reason: string | null;
  author: string;
  from: string | null;
}

/** Последний по времени `ticket.returned` — плашка «Возвращена инженером: причина». */
export function lastReturn(events: readonly unknown[], options: JournalOptions = {}): ReturnInfo | null {
  let latest: ReturnInfo | null = null;
  events.forEach((raw, index) => {
    if (!isRecord(raw) || raw.type !== 'ticket.returned') return;
    const payload = isRecord(raw.payload) ? raw.payload : {};
    const actor = actorOf(raw);
    const at = typeof raw.at === 'string' ? raw.at : undefined;
    const candidate: ReturnInfo = {
      at,
      time: parseTime(at) ?? -index,
      reason: readString(payload.reason),
      author: (actor.id ? options.actorName?.(actor.id) : null) ?? ACTOR_FALLBACK[actor.kind],
      from: readString(payload.from),
    };
    if (!latest || candidate.time > latest.time) latest = candidate;
  });
  return latest;
}

/* ---------- Клавиатура: только спорные поля ---------- */

/** Поля, по которым ходит Tab: спорные (`needsReview`). Порядок — как в реестре. */
export function reviewFieldKeys(
  groups: ReadonlyArray<{ fields: ReadonlyArray<{ key: string; field: TicketField | null }> }>,
): string[] {
  return groups.flatMap((group) =>
    group.fields.filter((entry) => entry.field?.needsReview).map((entry) => entry.key),
  );
}

/** Поля для показа: заполненные и спорные. Пустые без пометки не засоряют шаг. */
export function visibleReviewGroups(groups: readonly ReviewGroup[]): ReviewGroup[] {
  return groups
    .map((group) => ({
      ...group,
      fields: group.fields.filter((entry) => {
        const field = entry.field;
        if (!field) return false;
        if (field.needsReview) return true;
        return field.value !== null && `${field.value}`.trim() !== '';
      }),
    }))
    .filter((group) => group.fields.length > 0);
}

/** Сколько полей реально видит диспетчер на шаге «Поля». */
export function filledFieldCount(groups: readonly ReviewGroup[]): number {
  return visibleReviewGroups(groups).reduce((total, group) => total + group.fields.length, 0);
}

/* ---------- След разбора: «Нашёл → Сверил → Спросил → Вам» ---------- */

export type TraceStage = 'found' | 'checked' | 'asked' | 'you';

export interface TraceStepView {
  id: string;
  stage: TraceStage;
  stageLabel: string;
  text: string;
  at?: string;
  tone: UiTone;
}

const STAGE_LABELS: Record<TraceStage, string> = {
  found: 'Нашёл',
  checked: 'Сверил',
  asked: 'Спросил',
  you: 'Вам',
};

const STAGE_ORDER: Record<TraceStage, number> = { found: 0, checked: 1, asked: 2, you: 3 };

/** Сколько строк одного этапа показываем: длинный список цитат не помещается в шаг. */
const STAGE_LIMIT: Record<TraceStage, number> = { found: 2, checked: 2, asked: 2, you: 2 };

const TRACE_KIND_STAGE: Record<string, TraceStage> = {
  found: 'found',
  not_found: 'found',
  rejected: 'found',
  matched_cmdb: 'checked',
  computed: 'checked',
  from_profile: 'checked',
  asked: 'asked',
  answered: 'asked',
  no_answer: 'you',
  corrected: 'you',
};

function traceText(kind: string, note: string | null, quote: string | null): string {
  if (kind === 'found') return quote ? `Нашёл: «${quote}»` : 'Нашёл в тексте';
  if (kind === 'not_found') return 'Не нашёл — спрошу';
  if (kind === 'rejected') return 'Отклонил вариант';
  if (kind === 'matched_cmdb') return 'Сверил с базой оборудования';
  if (kind === 'computed') return 'Посчитал по правилу';
  if (kind === 'from_profile') return 'Взял из профиля';
  if (kind === 'asked') return note ? `Спросил: ${note}` : 'Спросил заявителя';
  if (kind === 'answered') return quote ?? note ? `Ответ: «${quote ?? note}»` : 'Заявитель ответил';
  if (kind === 'no_answer') return 'Ответа нет — вопрос диспетчеру';
  if (kind === 'corrected') return 'Диспетчер исправил';
  return kind;
}

function traceTone(stage: TraceStage): UiTone {
  if (stage === 'found') return 'ok';
  if (stage === 'checked') return 'accent';
  if (stage === 'asked') return 'info';
  return 'warn';
}

interface RawTrace {
  kind: string;
  note: string | null;
  quote: string | null;
  at?: string;
  index: number;
}

function traceOfRecord(value: unknown, index: number): RawTrace | null {
  if (!isRecord(value)) return null;
  const kind = readString(value.kind);
  if (!kind || !TRACE_KIND_STAGE[kind]) return null;
  return {
    kind,
    note: readString(value.note),
    quote: readString(value.quote),
    at: readString(value.at) ?? undefined,
    index,
  };
}

function analysisTrace(analysis: Record<string, unknown> | null | undefined): RawTrace[] {
  const fields = analysis ? analysis.fields : undefined;
  if (!isRecord(fields)) return [];
  const result: RawTrace[] = [];
  for (const value of Object.values(fields)) {
    if (!isRecord(value) || !Array.isArray(value.trace)) continue;
    value.trace.forEach((entry) => {
      const parsed = traceOfRecord(entry, result.length);
      if (parsed) result.push(parsed);
    });
  }
  return result;
}

function fieldTraceFallback(fields: readonly TicketField[]): RawTrace[] {
  const result: RawTrace[] = [];
  for (const field of fields) {
    for (const entry of field.trace) {
      const parsed = traceOfRecord(entry, result.length);
      if (parsed) result.push(parsed);
    }
    if (field.trace.length > 0) continue;
    const key = field.fieldKey;
    if (field.quote?.text) {
      result.push({ kind: 'found', note: null, quote: field.quote.text, index: result.length });
    }
    if (field.origin === 'cmdb') result.push({ kind: 'matched_cmdb', note: key, quote: null, index: result.length });
    if (field.origin === 'asked') result.push({ kind: 'asked', note: key, quote: null, index: result.length });
    if (field.origin === 'human') result.push({ kind: 'corrected', note: key, quote: null, index: result.length });
    if (field.needsReview) result.push({ kind: 'no_answer', note: key, quote: null, index: result.length });
  }
  return result;
}

/**
 * Шаги следа для блока «Обращение»: сначала настоящий `trace` из `analysis.fields`,
 * если его нет — собираем из полей заявки. Дубли и неизвестные виды отбрасываются.
 */
export function traceSteps(
  analysis: Record<string, unknown> | null | undefined,
  fields: readonly TicketField[],
): TraceStepView[] {
  const raw = analysisTrace(analysis);
  const source = raw.length > 0 ? raw : fieldTraceFallback(fields);
  const seen = new Set<string>();
  const steps: TraceStepView[] = [];
  for (const entry of source) {
    const stage = TRACE_KIND_STAGE[entry.kind];
    if (!stage) continue;
    const text = traceText(entry.kind, entry.note, entry.quote);
    const id = `${entry.kind}|${text}`;
    if (seen.has(id)) continue;
    seen.add(id);
    steps.push({
      id,
      stage,
      stageLabel: STAGE_LABELS[stage],
      text,
      at: entry.at,
      tone: traceTone(stage),
    });
  }
  const byStage = new Map<TraceStage, number>();
  return steps
    .sort(
      (left, right) =>
        STAGE_ORDER[left.stage] - STAGE_ORDER[right.stage] ||
        (left.at && right.at ? left.at.localeCompare(right.at) : 0),
    )
    .filter((step) => {
      const used = byStage.get(step.stage) ?? 0;
      if (used >= STAGE_LIMIT[step.stage]) return false;
      byStage.set(step.stage, used + 1);
      return true;
    });
}

export interface EmergencyNote {
  level: 'suspected' | 'confirmed';
  confidence: number;
  signs: string[];
}

/** Авария из `analysis.emergency` — для шапки проверки и стикера. */
export function analysisEmergency(
  analysis: Record<string, unknown> | null | undefined,
): EmergencyNote | null {
  if (!analysis || !isRecord(analysis.emergency)) return null;
  const level = readString(analysis.emergency.level);
  if (level !== 'suspected' && level !== 'confirmed') return null;
  const rawConfidence = analysis.emergency.confidence;
  const confidence =
    typeof rawConfidence === 'number' && Number.isFinite(rawConfidence)
      ? Math.min(1, Math.max(0, rawConfidence))
      : 0;
  const signsRaw = analysis.emergency.signs;
  const signs: string[] = [];
  if (Array.isArray(signsRaw)) {
    for (const sign of signsRaw) {
      const text = isRecord(sign) ? (readString(sign.quote) ?? readString(sign.sign)) : readString(sign);
      if (text && !signs.includes(text)) signs.push(text);
    }
  }
  return { level, confidence, signs };
}

/** Процент совпадения кандидата относительно лучшего балла: 0…99, без ложных 100 %. */
export function candidatePercent(score: number, best: number): number {
  if (!Number.isFinite(score) || !Number.isFinite(best) || best <= 0) return 0;
  return Math.max(1, Math.min(99, Math.round((score / best) * 100)));
}

/** Черновик ответа заявителю. ИИ-черновика в API пока нет — шаблон собирается из полей заявки. */
export function replyTemplate(
  ticket: Pick<Ticket, 'number'>,
  assigneeName: string | null,
  due: string | null,
): string {
  const who = assigneeName ?? 'Инженер';
  const when = due ? `придёт ${due}` : 'свяжется с вами';
  return `Заявка № ${ticket.number} принята. ${who} ${when}. Если проблема повторится, ответьте в этом чате.`;
}

/** Код справочника → подпись; неизвестный код остаётся как есть. */
export function fieldDisplayValue(
  meta: { fields: readonly FieldDef[]; dictionaries: readonly { dictionary: string; code: string; label: string }[] },
  key: string,
  value: string | null,
): string | null {
  if (value === null) return null;
  const def = meta.fields.find((field) => field.key === key);
  if (!def || def.type !== 'dictionary' || !def.dictionary) return value;
  return meta.dictionaries.find((item) => item.dictionary === def.dictionary && item.code === value)?.label ?? value;
}

/** Варианты поля-справочника для правки диспетчером. */
export function fieldOptions(
  meta: { fields: readonly FieldDef[]; dictionaries: readonly { dictionary: string; code: string; label: string }[] },
  key: string,
): Array<{ code: string; label: string }> {
  const def = meta.fields.find((field) => field.key === key);
  if (!def || def.type !== 'dictionary' || !def.dictionary) return [];
  return meta.dictionaries
    .filter((item) => item.dictionary === def.dictionary)
    .map((item) => ({ code: item.code, label: item.label }));
}
