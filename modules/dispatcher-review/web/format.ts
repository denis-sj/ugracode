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
