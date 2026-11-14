import type { DictionaryItem, FieldDef, Ticket, User } from '@ugra/contracts';

/**
 * Чистые функции журнала действий (экран 07 «Журнал»): вкладки-фильтры, период,
 * «было → стало», топ исправляемых полей и человеческие подписи.
 * Служебные шаги пайплайна (`analysis.step.completed`, `agent.step`) отсекаются здесь,
 * чтобы на экране не было ни сырых кодов, ни технического шума.
 * Ничего не знает про React и сеть — всё проверяется тестами без DOM.
 */

export type JournalGroupId = 'all' | 'edits' | 'confirmations' | 'emergency';
export type JournalPeriod = 'today' | 'week';

export interface JournalGroupDef {
  id: JournalGroupId;
  label: string;
  /** Типы событий вкладки; пусто — вкладка «Все». */
  types: readonly string[];
}

/** Вкладки журнала из макета `07-disp-journal-a`: Все / Правки ИИ / Подтверждения / Аварии. */
export const JOURNAL_GROUPS: readonly JournalGroupDef[] = [
  { id: 'all', label: 'Все', types: [] },
  { id: 'edits', label: 'Правки ИИ', types: ['ticket.field.corrected'] },
  {
    id: 'confirmations',
    label: 'Подтверждения',
    types: ['ticket.confirmed', 'ticket.assigned', 'ticket.returned'],
  },
  { id: 'emergency', label: 'Аварии', types: ['emergency.detected', 'mass-incident.opened'] },
];

/**
 * Служебные события: шаги разбора и агента, промахи базы знаний и заполнение полей ИИ.
 * Диспетчеру они ничего не говорят — в журнале их нет, вместо них одна строка «скрыто N».
 * Заполнение полей при этом остаётся в знаменателе сводки (`correctedSummary`).
 */
export const SERVICE_EVENT_TYPES: readonly string[] = [
  'analysis.step.completed',
  'agent.step',
  'ticket.field.set',
  'report-kb-gaps.miss',
];

export function isServiceEvent(row: { type: string; service?: boolean }): boolean {
  return row.service ?? SERVICE_EVENT_TYPES.includes(row.type);
}

/**
 * Статусы, в которые заявку переводит сам разбор («Новая → Разбор ИИ → На проверке»).
 * Для диспетчера это техническая механика: показываем только его собственные статусы.
 */
export const PIPELINE_STATUSES: readonly string[] = ['ai_draft', 'in_review'];

function isPipelineStatus(type: string, payload: Record<string, unknown>): boolean {
  if (type !== 'ticket.status.changed') return false;
  const to = readString(payload.to);
  return to !== null && PIPELINE_STATUSES.includes(to);
}

export interface JournalFilters {
  group: JournalGroupId;
  period: JournalPeriod;
}

export const DEFAULT_JOURNAL_FILTERS: JournalFilters = {
  group: 'all',
  period: 'week',
};

export type JournalTone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger' | 'info';
export type JournalActorKind = 'user' | 'ai' | 'system' | 'unknown';

export const STATUS_LABELS: Record<string, string> = {
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

/** Человеческие подписи событий: ни один код типа не попадает на экран. */
export const EVENT_TITLES: Record<string, string> = {
  'appeal.created': 'Обращение создано',
  'analysis.started': 'ИИ начал разбор',
  'analysis.step.completed': 'Шаг разбора выполнен',
  'analysis.completed': 'ИИ разобрал обращение',
  'agent.step': 'Шаг агента',
  'run.failed': 'Разбор не удался',
  'ticket.field.set': 'ИИ заполнил поле',
  'ticket.field.corrected': 'Поле исправлено человеком',
  'ticket.confirmed': 'Заявка подтверждена',
  'ticket.assigned': 'Назначен исполнитель',
  'ticket.status.changed': 'Статус изменён',
  'ticket.deadline.extended': 'Срок продлён',
  'ticket.returned': 'Возвращена диспетчеру',
  'message.sent': 'Сообщение заявителю',
  'setting.changed': 'Изменена настройка',
  'emergency.detected': 'Обнаружены признаки аварии',
  'mass-incident.opened': 'Открыт массовый инцидент',
  'report-kb-gaps.miss': 'Пробел в базе знаний',
  'example.matched': 'Сработал модуль-пример',
};

/** Подпись периода для сводки: «За сегодня» / «За 7 дней». */
export function periodLabel(period: JournalPeriod): string {
  return period === 'today' ? 'За сегодня' : 'За 7 дней';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() === '' ? null : value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function readFieldKey(payload: Record<string, unknown>): string | null {
  return readString(payload.fieldKey) ?? readString(payload.key);
}

function actorOf(event: unknown): { kind: JournalActorKind; id: string | null } {
  if (!isRecord(event) || !isRecord(event.actor)) return { kind: 'unknown', id: null };
  const kind = event.actor.kind;
  return {
    kind: kind === 'user' || kind === 'ai' || kind === 'system' ? kind : 'unknown',
    id: readString(event.actor.id),
  };
}

/** Автор события: имя из справочника, иначе «ИИ», «система» или «человек». */
export function actorLabel(event: unknown, resolveName?: (id: string) => string | null): string {
  const actor = actorOf(event);
  if (actor.kind === 'ai') return 'ИИ';
  if (actor.kind === 'system') return 'система';
  if (actor.kind === 'user') return (actor.id === null ? null : resolveName?.(actor.id)) ?? 'человек';
  return 'неизвестно';
}

/**
 * Короткая подпись автора: «Ксения Нестерова» → «Ксения Н.».
 * Односложные подписи («ИИ», «система») остаются как есть.
 */
export function shortPersonName(fullName: string): string {
  const words = fullName
    .trim()
    .split(/\s+/)
    .filter((word) => word !== '');
  const first = words[0] ?? '';
  if (first === '') return 'Без имени';
  if (words.length === 1) return first;
  const last = words[words.length - 1] ?? '';
  return `${first} ${last.charAt(0).toUpperCase()}.`;
}

/**
 * Номер заявки для правой колонки: «З-20261114-0001» → «…0001».
 * Полный номер остаётся в подсказке ссылки — в колонке 84 px он не помещается.
 */
export function shortTicketNumber(number: string): string {
  const trimmed = number.trim();
  if (trimmed.length <= 6) return trimmed;
  return `…${trimmed.slice(-4)}`;
}

/**
 * Автор строки журнала: «Анна М.», «ИИ», «система».
 * `null` — автор уже назван в заголовке события («ИИ разобрал обращение»).
 */
export function actorSuffix(row: JournalRow): string | null {
  const name = shortPersonName(row.actor);
  return row.title.includes(name) ? null : name;
}

/** Русское склонение: `plural(23, 'правка', 'правки', 'правок')` → «правки». */
export function plural(count: number, one: string, few: string, many: string): string {
  const value = Math.abs(Math.trunc(Number.isFinite(count) ? count : 0));
  const tail = value % 100;
  if (tail >= 11 && tail <= 14) return many;
  const last = value % 10;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

/** «на 23 примерах» / «на 21 примере» — вывод блока «Что чаще исправляют». */
export function trainingExamples(count: number): string {
  const value = Math.max(0, Math.trunc(Number.isFinite(count) ? count : 0));
  const tail = value % 100;
  const single = tail % 10 === 1 && tail !== 11;
  return `на ${value} ${single ? 'примере' : 'примерах'}`;
}

export interface EventTitleLabels {
  fieldLabel?: (key: string) => string | null;
  userName?: (id: string) => string | null;
}

/** Подпись поля из настроек; без подписи — `null`, чтобы на экран не попал машинный ключ. */
function fieldTitle(key: string | null, labels: EventTitleLabels): string | null {
  if (key === null) return null;
  return labels.fieldLabel?.(key) ?? null;
}

function assigneeName(payload: Record<string, unknown>, labels: EventTitleLabels): string | null {
  const id = readString(payload.assigneeId);
  return id === null ? null : labels.userName?.(id) ?? null;
}

/** Человеческая подпись события с деталями payload; неизвестный тип — «Событие», без кода. */
export function eventTitle(event: unknown, labels: EventTitleLabels = {}): string {
  if (!isRecord(event)) return 'Событие';
  const type = readString(event.type) ?? 'event';
  const payload = isRecord(event.payload) ? event.payload : {};
  const base = EVENT_TITLES[type] ?? 'Событие';
  const field = fieldTitle(readFieldKey(payload), labels);

  switch (type) {
    case 'ticket.field.corrected':
      return field === null ? base : `Поле «${field}» исправлено`;
    case 'ticket.field.set':
      return field === null ? base : `ИИ заполнил поле «${field}»`;
    case 'ticket.confirmed':
      return assigneeName(payload, labels) === null ? base : 'Подтверждена и назначена';
    case 'emergency.detected':
      return readString(payload.level) === 'confirmed' ? 'Авария подтверждена' : base;
    case 'mass-incident.opened': {
      const number = readString(payload.number);
      const size = typeof payload.size === 'number' && Number.isFinite(payload.size) ? payload.size : null;
      if (number !== null && size !== null) return `Массовый сбой № ${number}: ${size} заявок`;
      if (size !== null) return `Массовый сбой: ${size} заявок`;
      return base;
    }
    default:
      return base;
  }
}

export interface PayloadDiff {
  fieldKey: string | null;
  before: string | null;
  after: string | null;
}

/**
 * «Было → стало» из payload события: `previous`/`aiValue` → `value`, для статуса — `from` → `to`.
 * Пусто или битый payload — `null`; одинаковые значения диффом не считаются.
 */
export function diffPayload(payload: unknown): PayloadDiff | null {
  if (!isRecord(payload)) return null;
  const before = readString(payload.previous) ?? readString(payload.aiValue) ?? readString(payload.from);
  const after = readString(payload.value) ?? readString(payload.to);
  if (before === null && after === null) return null;
  if (before !== null && after !== null && before === after) return null;
  return { fieldKey: readFieldKey(payload), before, after };
}

export interface DiffSegment {
  text: string;
  /** Фрагмент, которого нет в другом значении. */
  changed: boolean;
}

export interface ValueDiff {
  before: DiffSegment[];
  after: DiffSegment[];
  changed: boolean;
}

function tokenize(text: string): string[] {
  return text.split(/(\s+)/).filter((token) => token !== '');
}

function mark(token: string, changed: boolean): DiffSegment {
  return { text: token, changed: changed && token.trim() !== '' };
}

function pushSegment(target: DiffSegment[], segment: DiffSegment): void {
  const last = target[target.length - 1];
  if (last && last.changed === segment.changed) {
    last.text += segment.text;
    return;
  }
  target.push(segment);
}

/** Пословное сравнение значений для подсветки отличий; устойчиво к `null` и лишним пробелам. */
export function valueDiff(before: string | null, after: string | null): ValueDiff {
  const left = before === null ? [] : tokenize(before);
  const right = after === null ? [] : tokenize(after);

  if (left.join('') === right.join('')) {
    return {
      before: before === null ? [] : [mark(before, false)],
      after: after === null ? [] : [mark(after, false)],
      changed: false,
    };
  }

  const table: number[][] = Array.from({ length: left.length + 1 }, () =>
    new Array<number>(right.length + 1).fill(0),
  );
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

export interface JournalDiff {
  fieldKey: string | null;
  before: string | null;
  after: string | null;
  beforeSegments: DiffSegment[];
  afterSegments: DiffSegment[];
  changed: boolean;
}

export interface JournalRow {
  id: string;
  type: string;
  /** ISO-время события; `null` — битая или отсутствующая дата. */
  at: string | null;
  /** Время в миллисекундах; 0 — дата неизвестна. */
  time: number;
  actor: string;
  actorKind: JournalActorKind;
  ticketId: string | null;
  ticketNumber: string | null;
  title: string;
  /** Вторая строка события: признаки, причина, число собранных полей. */
  description: string | null;
  fieldKey: string | null;
  fieldLabel: string | null;
  diff: JournalDiff | null;
  tone: JournalTone;
  /** Служебное событие: в списке не показываем. */
  service: boolean;
}

export interface JournalOptions {
  users?: readonly User[];
  tickets?: readonly Ticket[];
  fields?: readonly FieldDef[];
  dictionaries?: readonly DictionaryItem[];
}

export function eventTone(type: string): JournalTone {
  if (type === 'emergency.detected' || type === 'mass-incident.opened' || type === 'run.failed') return 'danger';
  if (type === 'ticket.field.corrected' || type === 'ticket.returned') return 'warn';
  if (type === 'ticket.confirmed' || type === 'ticket.assigned' || type === 'analysis.completed') return 'ok';
  if (type === 'ticket.status.changed') return 'info';
  if (type.startsWith('analysis.')) return 'accent';
  return 'neutral';
}

function parseTime(value: string | null): number {
  if (value === null) return 0;
  const time = Date.parse(value);
  return Number.isNaN(time) ? 0 : time;
}

/** Подпись значения поля: коды справочников — человеческими словами. */
function valueFormatter(
  options: JournalOptions,
): (key: string | null, value: string | null) => string | null {
  const defs = new Map((options.fields ?? []).map((def) => [def.key, def]));
  const dictionaries = new Map(
    (options.dictionaries ?? []).map((item) => [`${item.dictionary}|${item.code}`, item.label] as const),
  );
  return (key, value) => {
    if (value === null || key === null) return value;
    const def = defs.get(key);
    if (!def || def.type !== 'dictionary' || !def.dictionary) return value;
    return dictionaries.get(`${def.dictionary}|${value}`) ?? value;
  };
}

function signsText(payload: Record<string, unknown>): string | null {
  const signs = Array.isArray(payload.signs) ? payload.signs : [];
  const quotes: string[] = [];
  for (const sign of signs) {
    const text = isRecord(sign) ? (readString(sign.quote) ?? readString(sign.sign)) : readString(sign);
    if (text !== null && !quotes.includes(text)) quotes.push(text);
    if (quotes.length === 2) break;
  }
  if (quotes.length === 0) return null;
  return quotes.map((quote) => `«${quote}»`).join(', ');
}

function descriptionOf(
  type: string,
  payload: Record<string, unknown>,
  format: (key: string | null, value: string | null) => string | null,
  labels: EventTitleLabels,
): string | null {
  if (type === 'ticket.field.set') {
    const value = format(readFieldKey(payload), readString(payload.value));
    return value === null ? null : `предложено: ${value}`;
  }
  if (type === 'ticket.confirmed' || type === 'ticket.assigned') {
    const name = assigneeName(payload, labels);
    return name === null ? null : `исполнитель: ${name}`;
  }
  if (type === 'analysis.completed') {
    const fields = Array.isArray(payload.fields) ? payload.fields.length : 0;
    return fields > 0 ? `${fields} ${plural(fields, 'поле', 'поля', 'полей')}` : null;
  }
  if (type === 'emergency.detected') return signsText(payload);
  const reason = readString(payload.reason);
  if (reason !== null) return `причина: ${reason}`;
  return null;
}

function rowOf(raw: unknown, index: number, options: JournalOptions): JournalRow {
  const format = valueFormatter(options);
  const users = new Map((options.users ?? []).map((user) => [user.id, user.fullName] as const));
  const tickets = new Map((options.tickets ?? []).map((ticket) => [ticket.id, ticket.number] as const));
  const fields = new Map((options.fields ?? []).map((def) => [def.key, def.label] as const));
  const labels: EventTitleLabels = {
    fieldLabel: (key) => fields.get(key) ?? null,
    userName: (id) => users.get(id) ?? null,
  };

  if (!isRecord(raw)) {
    return {
      id: `event-${index}`,
      type: 'event',
      at: null,
      time: 0,
      actor: 'неизвестно',
      actorKind: 'unknown',
      ticketId: null,
      ticketNumber: null,
      title: 'Событие',
      description: null,
      fieldKey: null,
      fieldLabel: null,
      diff: null,
      tone: 'neutral',
      service: true,
    };
  }

  const type = readString(raw.type) ?? 'event';
  const payload = isRecord(raw.payload) ? raw.payload : {};
  const at = readString(raw.at);
  const actor = actorOf(raw);
  const fieldKey = readFieldKey(payload);
  const fieldLabel = fieldKey === null ? null : (fields.get(fieldKey) ?? null);
  const rawDiff = type === 'ticket.field.corrected' || type === 'ticket.status.changed' ? diffPayload(payload) : null;
  const prettify = (value: string | null): string | null => {
    if (value === null) return null;
    if (type === 'ticket.status.changed') return STATUS_LABELS[value] ?? 'другой статус';
    return format(rawDiff?.fieldKey ?? null, value);
  };
  const before = rawDiff === null ? null : prettify(rawDiff.before);
  const after = rawDiff === null ? null : prettify(rawDiff.after);
  const segments = rawDiff === null ? null : valueDiff(before, after);
  const diff: JournalDiff | null =
    rawDiff === null || segments === null
      ? null
      : {
          fieldKey: rawDiff.fieldKey,
          before,
          after,
          beforeSegments: segments.before,
          afterSegments: segments.after,
          changed: segments.changed,
        };
  const ticketId = readString(raw.ticketId);

  return {
    id: readString(raw.id) ?? `event-${index}`,
    type,
    at,
    time: parseTime(at),
    actor: actorLabel(raw, (id) => users.get(id) ?? null),
    actorKind: actor.kind,
    ticketId,
    ticketNumber: ticketId === null ? null : (tickets.get(ticketId) ?? null),
    title: eventTitle(raw, labels),
    description: descriptionOf(type, payload, format, labels),
    fieldKey,
    fieldLabel,
    diff,
    tone: eventTone(type),
    service: SERVICE_EVENT_TYPES.includes(type) || isPipelineStatus(type, payload),
  };
}

/** Сырые события API → строки журнала: новые сверху, имена и номера заявок — из справочников. */
export function toJournalRows(events: readonly unknown[], options: JournalOptions = {}): JournalRow[] {
  const rows = events
    .map((raw, index) => rowOf(raw, index, options))
    .sort((left, right) => right.time - left.time);
  return mergeAssignments(rows);
}

/** Подтверждение и назначение — одно действие диспетчера: ядро пишет два события подряд. */
const CONFIRM_MERGE_MS = 60_000;

/**
 * Убирает «Назначен исполнитель», если в пределах минуты по той же заявке есть
 * «Подтверждена и назначена»: в журнале это одна строка, а не две.
 */
export function mergeAssignments(rows: readonly JournalRow[]): JournalRow[] {
  const confirmations = rows.filter((row) => row.type === 'ticket.confirmed' && row.ticketId !== null);
  if (confirmations.length === 0) return [...rows];
  return rows.filter((row) => {
    if (row.type !== 'ticket.assigned' || row.ticketId === null) return true;
    const paired = confirmations.some(
      (confirmed) =>
        confirmed.ticketId === row.ticketId && Math.abs(confirmed.time - row.time) <= CONFIRM_MERGE_MS,
    );
    return !paired;
  });
}

export interface JournalGroupCount extends JournalGroupDef {
  count: number;
}

/** Вкладки с числом событий: служебные шаги в счёт не идут — тот же источник, что у списка. */
export function eventGroups(rows: readonly JournalRow[]): JournalGroupCount[] {
  const visible = rows.filter((row) => !isServiceEvent(row));
  return JOURNAL_GROUPS.map((group) => ({
    ...group,
    count:
      group.id === 'all'
        ? visible.length
        : visible.filter((row) => group.types.includes(row.type)).length,
  }));
}

function startOfDay(now: number): number {
  const date = new Date(now);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Попадает ли событие в период: «сегодня» — с местной полуночи, «7 дней» — последние 168 часов. */
export function inPeriod(time: number, period: JournalPeriod, now: number): boolean {
  if (time <= 0) return false;
  if (period === 'today') return time >= startOfDay(now);
  return time >= now - 7 * 24 * 60 * 60 * 1000;
}

/** Фильтр журнала: вкладка и период. Служебные события не показываются ни на одной вкладке. */
export function filterEvents(
  rows: readonly JournalRow[],
  filters: JournalFilters,
  now: number,
): JournalRow[] {
  const group = JOURNAL_GROUPS.find((entry) => entry.id === filters.group) ?? JOURNAL_GROUPS[0];
  return rows.filter((row) => {
    if (isServiceEvent(row)) return false;
    if (group && group.id !== 'all' && !group.types.includes(row.type)) return false;
    return inPeriod(row.time, filters.period, now);
  });
}

/** Сколько служебных событий скрыто в периоде — одна честная строка под списком. */
export function serviceEventCount(
  rows: readonly JournalRow[],
  period: JournalPeriod,
  now: number,
): number {
  return rows.filter((row) => isServiceEvent(row) && inPeriod(row.time, period, now)).length;
}

/** Сколько правок помещается в верхний блок «ИИ предложил → человек исправил». */
export const FIXES_IN_BLOCK = 4;

/** Сколько событий показываем в «Остальных событиях» до кнопки «Показать ещё». */
export const REST_IN_BLOCK = 6;

export interface JournalFeed {
  /** Правки для верхнего блока, самые свежие сверху. */
  fixes: JournalRow[];
  /** Остальные события; лишние правки тоже здесь, чтобы ни одно событие не потерялось. */
  rest: JournalRow[];
  /** Сколько правок не поместилось в верхний блок. */
  hiddenFixes: number;
}

/** Делит видимые события: до `limit` правок — наверх, всё остальное — в «Остальные события». */
export function splitJournal(rows: readonly JournalRow[], limit = FIXES_IN_BLOCK): JournalFeed {
  const corrections = rows.filter((row) => row.type === 'ticket.field.corrected');
  const fixes = corrections.slice(0, Math.max(1, limit));
  const inFixes = new Set(fixes.map((row) => row.id));
  return {
    fixes,
    rest: rows.filter((row) => !inFixes.has(row.id)),
    hiddenFixes: Math.max(0, corrections.length - fixes.length),
  };
}

export interface CorrectedSummary {
  /** Сколько полей человек исправил после ИИ. */
  corrections: number;
  /** Сколько полей ИИ заполнил сам (`ticket.field.set`) — знаменатель доли правок. */
  aiFields: number;
}

/**
 * Счётчики для подписи «За 7 дней — N правок из M полей».
 * Считает по периоду, а не по вкладке: сводка справа — про период, а не про выбранный фильтр.
 * Заполнение полей ИИ в списке скрыто, но в знаменателе остаётся.
 */
export function correctedSummary(
  rows: readonly JournalRow[],
  period: JournalPeriod,
  now: number,
): CorrectedSummary {
  let corrections = 0;
  let aiFields = 0;
  for (const row of rows) {
    if (!inPeriod(row.time, period, now)) continue;
    if (row.type === 'ticket.field.corrected') corrections += 1;
    else if (row.type === 'ticket.field.set') aiFields += 1;
  }
  return { corrections, aiFields };
}

/** Подпись под заголовком блока «Что чаще исправляют»: «За 7 дней — 23 правки из 412 полей». */
export function correctedCaption(summary: CorrectedSummary, period: JournalPeriod): string {
  const corrections = `${periodLabel(period)} — ${summary.corrections} ${plural(
    summary.corrections,
    'правка',
    'правки',
    'правок',
  )}`;
  if (summary.aiFields <= 0) return corrections;
  return `${corrections} из ${summary.aiFields} ${plural(summary.aiFields, 'поля', 'полей', 'полей')}`;
}

/** Название поля правки для заголовка строки: без машинного ключа, если подписи нет. */
export function correctedFieldLabel(row: JournalRow): string {
  if (row.fieldLabel === null || row.fieldLabel === row.fieldKey) return 'Поле';
  return row.fieldLabel;
}

export interface CorrectedPair {
  before: string | null;
  after: string | null;
}

export interface CorrectedField {
  fieldKey: string;
  label: string;
  count: number;
  /** Доля от всех правок, 0…100. */
  percent: number;
  /** Длина полоски: доля от самого частого поля, 0…100. */
  share: number;
  /** Самая частая пара «было → стало» у этого поля. */
  pair: CorrectedPair | null;
}

interface FieldBucket {
  fieldKey: string;
  label: string;
  count: number;
  pairs: Map<string, CorrectedPair & { count: number }>;
}

function bucketOf(buckets: Map<string, FieldBucket>, row: JournalRow): FieldBucket {
  const key = row.fieldKey ?? '';
  const bucket = buckets.get(key) ?? {
    fieldKey: key,
    label: correctedFieldLabel(row),
    count: 0,
    pairs: new Map<string, CorrectedPair & { count: number }>(),
  };
  bucket.count += 1;
  const before = row.diff?.before ?? null;
  const after = row.diff?.after ?? null;
  if (before !== null || after !== null) {
    const pairKey = `${before ?? ''}\u0000${after ?? ''}`;
    const pair = bucket.pairs.get(pairKey) ?? { before, after, count: 0 };
    pair.count += 1;
    bucket.pairs.set(pairKey, pair);
  }
  buckets.set(key, bucket);
  return bucket;
}

function mostFrequentPair(bucket: FieldBucket): CorrectedPair | null {
  let best: (CorrectedPair & { count: number }) | null = null;
  for (const pair of bucket.pairs.values()) {
    if (best === null || pair.count > best.count) best = pair;
  }
  return best === null ? null : { before: best.before, after: best.after };
}

/** Топ полей, которые человек исправлял после ИИ (`ticket.field.corrected`). */
export function topCorrectedFields(rows: readonly JournalRow[], limit = 5): CorrectedField[] {
  const corrections = rows.filter((row) => row.type === 'ticket.field.corrected');
  if (corrections.length === 0) return [];

  const buckets = new Map<string, FieldBucket>();
  for (const row of corrections) bucketOf(buckets, row);

  const sorted = [...buckets.values()]
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
    .slice(0, Math.max(1, limit));
  const maxCount = sorted[0]?.count ?? 1;

  return sorted.map((bucket) => ({
    fieldKey: bucket.fieldKey,
    label: bucket.label,
    count: bucket.count,
    percent: Math.round((bucket.count / corrections.length) * 100),
    share: Math.round((bucket.count / maxCount) * 100),
    pair: mostFrequentPair(bucket),
  }));
}

/** Подпись под полоской: «Сети ↔ Рабочие места» — что ИИ путал в этом поле. */
export function pairLabel(pair: CorrectedPair | null): string | null {
  if (pair === null) return null;
  if (pair.before !== null && pair.after !== null) return `${pair.before} ↔ ${pair.after}`;
  if (pair.after !== null) return `добавляли «${pair.after}»`;
  if (pair.before !== null) return `убирали «${pair.before}»`;
  return null;
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

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Время события для строки журнала: «только что», «5 мин назад», «10:44» (сегодня),
 * «вчера, 16:20», «8 нояб.». Битая дата — «—».
 */
export function relativeTime(iso: string | null | undefined, now: number): string {
  if (iso === null || iso === undefined || iso === '') return '—';
  const date = new Date(iso);
  const time = date.getTime();
  if (Number.isNaN(time)) return '—';

  const diff = now - time;
  if (diff >= 0 && diff < 60_000) return 'только что';
  if (diff >= 0 && diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))} мин назад`;

  const today = startOfDay(now);
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (dayStart === today) return clock;
  if (dayStart === today - 86_400_000) return `вчера, ${clock}`;
  if (date.getFullYear() === new Date(now).getFullYear()) {
    return `${date.getDate()} ${MONTHS_SHORT[date.getMonth()] ?? ''}`.trim();
  }
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
}

/** Точное время для подсказки `title`: «14.11.2026, 10:44». */
export function fullTime(iso: string | null): string {
  if (iso === null) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}, ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}
