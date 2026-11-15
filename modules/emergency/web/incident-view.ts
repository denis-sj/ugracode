import type { Ticket, TicketField } from '@ugra/contracts';
import { formatAge, sortByRecent, type Place } from './format';

/**
 * Чистые функции экрана «Авария» (вариант B): человеческий заголовок вместо кодов,
 * русские подписи правил и событий, норма реакции из срока заявки, прошлые аварии
 * по корпусу и состояние кнопки «Назначить». Без React и без DOM — всё под тестами.
 */

/* ---------- Русские подписи кодов ---------- */

/** `data/emergency-rules.json` → `rules[].title`. Тест сверяет карту с файлом данных. */
const RULE_LABELS: Readonly<Record<string, string>> = {
  'emergency.fire': 'Пожар, дым, запах горелого',
  'emergency.water': 'Вода и протечка',
  'emergency.gas': 'Запах газа',
  'emergency.electric': 'Отказ электроснабжения и искрение',
  'emergency.network': 'Отказ сети или сервера для многих',
};

/** Служебные события разбора: на экране не должно быть `analysis.step.completed`. */
const EVENT_LABELS: Readonly<Record<string, string>> = {
  'analysis.step.started': 'Шаг разбора начат',
  'analysis.step.progress': 'Разбор продвинулся',
  'analysis.step.completed': 'Шаг разбора выполнен',
  'agent.step': 'Действие ИИ-агента',
  'run.completed': 'Разбор завершён',
  'run.failed': 'Разбор не удался',
};

const FALLBACK_EVENT = 'Событие';
const FALLBACK_RULE = 'правило регламента';

/** Подпись правила; неизвестный код не показываем на экране. */
export function ruleLabel(code: string): string | null {
  return RULE_LABELS[code] ?? null;
}

/** Подписи совпавших правил без повторов и без сырых кодов. */
export function ruleLabels(codes: readonly string[]): string[] {
  const labels = codes.flatMap((code) => {
    const label = ruleLabel(code);
    return label === null ? [] : [label];
  });
  return [...new Set(labels)];
}

/** Служебный тип события → русская подпись; неизвестный — «Событие», а не код. */
export function eventLabel(type: string): string {
  return EVENT_LABELS[type] ?? FALLBACK_EVENT;
}

function looksLikeCode(value: string): boolean {
  return !/[А-Яа-яЁё]/.test(value);
}

/** Технический идентификатор шага без слов: показывать его на экране нечего. */
function isTechnicalId(value: string): boolean {
  return /^[a-z][a-z0-9_.:-]*$/i.test(value.trim());
}

/**
 * Убирает коды из описания события: правила регламента, ключи полей и служебные
 * `emergency.*` / `analysis.*` заменяются русскими словами; чистый технический
 * идентификатор шага скрывается (пустая строка). Значения полей-справочников
 * (`category`, `serviceType`, `urgency`…) переводятся по `valueLabels`.
 */
export function humanizeEventText(
  text: string,
  fieldLabels: Readonly<Record<string, string>> = {},
  valueLabels: Readonly<Record<string, Readonly<Record<string, string>>>> = {},
): string {
  if (isTechnicalId(text)) return '';
  const segments = text.split(' · ').map((segment) => {
    const match = /^([A-Za-z][A-Za-z0-9_]*):\s*(.+)$/.exec(segment);
    if (!match) return segment;
    const [, key, value] = match;
    if (key === undefined || value === undefined) return segment;
    const keyLabel = fieldLabels[key];
    const valueLabel = valueLabels[key]?.[value];
    if (keyLabel === undefined && valueLabel === undefined) return segment;
    return `${keyLabel ?? key}: ${valueLabel ?? value}`;
  });

  let out = segments.join(' · ');
  for (const [code, label] of Object.entries(RULE_LABELS)) out = out.split(code).join(label);
  out = out.replace(/emergency\.[a-z_]+/g, FALLBACK_RULE);
  out = out.replace(/analysis\.[a-z_.]+/g, 'событие разбора');
  return out;
}

/** Служебные типы событий: шаги агента и внутренние отчёты — в хронологии не нужны. */
export function isServiceEvent(event: unknown): boolean {
  const type =
    typeof event === 'object' && event !== null && !Array.isArray(event)
      ? (event as Record<string, unknown>).type
      : null;
  if (typeof type !== 'string') return false;
  return type.startsWith('analysis.step.') || type.startsWith('report-') || type === 'agent.step';
}

export interface TimelineLike {
  id: string;
  title: string;
  description?: string;
  at?: string;
  tone: string;
}

/** Хронология без сырых кодов: заголовок-код → «Событие», описание — через `humanizeEventText`. */
export function sanitizeTimeline<T extends TimelineLike>(
  items: readonly T[],
  fieldLabels: Readonly<Record<string, string>> = {},
  valueLabels: Readonly<Record<string, Readonly<Record<string, string>>>> = {},
): Array<Omit<T, 'description'> & { description?: string }> {
  return items.map((item) => {
    const description =
      item.description === undefined
        ? undefined
        : humanizeEventText(item.description, fieldLabels, valueLabels);
    return {
      ...item,
      title: looksLikeCode(item.title) ? eventLabel(item.title) : item.title,
      description: description === '' ? undefined : description,
    };
  });
}

/* ---------- Человеческий заголовок ---------- */

function readField(
  fields: readonly Pick<TicketField, 'fieldKey' | 'value'>[] | null | undefined,
  key: string,
): string | null {
  const field = fields?.find((entry) => entry.fieldKey === key);
  if (!field || field.value === null) return null;
  const value = String(field.value).replace(/\s+/g, ' ').trim();
  return value === '' ? null : value;
}

const MAX_TITLE = 90;

/** Первая мысль текста заявителя — до запятой: заголовок не должен дублировать цитату целиком. */
function headlineFromText(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  const head = (oneLine.split(/[,;:.!?—–]/)[0] ?? '').trim();
  return head.length >= 12 ? head : oneLine;
}

/**
 * Заголовок карточки: «что случилось» словами заявителя, затем объект, затем категория,
 * затем — первая мысль обращения. Заголовок всегда человеческий, кода в нём нет.
 * `categoryLabel` уже должна быть русской подписью из справочника (null — подписи нет).
 */
export function incidentTitle(
  fields: readonly Pick<TicketField, 'fieldKey' | 'value'>[] | null | undefined,
  categoryLabel: string | null,
  text: string | null = null,
): string {
  const raw =
    readField(fields, 'symptoms') ??
    readField(fields, 'object') ??
    categoryLabel ??
    (text === null || text.trim() === '' ? null : headlineFromText(text));
  if (raw === null || raw.trim() === '') return 'Обращение';
  const oneLine = raw.replace(/\s+/g, ' ').trim();
  const capitalized = oneLine.charAt(0).toUpperCase() + oneLine.slice(1);
  return capitalized.length > MAX_TITLE ? `${capitalized.slice(0, MAX_TITLE - 1)}…` : capitalized;
}

/* ---------- Норма реакции ---------- */

/**
 * Норма реакции на аварию, минуты. Берём из срока заявки: `reactDueAt` рассчитан
 * сервером по `data/priority-matrix.json` (`levels.emergency.reactMinutes = 15`).
 * Нет срока или он битый — `null`, число не выдумываем.
 */
export function reactionNormMinutes(
  ticket: Pick<Ticket, 'createdAt' | 'reactDueAt'>,
): number | null {
  const created = Date.parse(ticket.createdAt);
  const due = ticket.reactDueAt === null ? Number.NaN : Date.parse(ticket.reactDueAt);
  if (!Number.isFinite(created) || !Number.isFinite(due) || due <= created) return null;
  const minutes = Math.round((due - created) / 60_000);
  return minutes >= 1 ? minutes : null;
}

export type ReactionState = 'unknown' | 'left' | 'overdue';

export function reactionState(normMinutes: number | null, elapsedMs: number): ReactionState {
  if (normMinutes === null) return 'unknown';
  return elapsedMs > normMinutes * 60_000 ? 'overdue' : 'left';
}

/**
 * Строка под таймером: «норма реакции 15 мин превышена» или «осталось 4 мин».
 * Минуты — из срока заявки, а не из макета.
 */
export function reactionText(normMinutes: number | null, elapsedMs: number): string {
  if (normMinutes === null) return 'норма реакции не задана';
  const limit = normMinutes * 60_000;
  if (elapsedMs > limit) return `норма реакции ${normMinutes} мин превышена`;
  return `норма реакции ${normMinutes} мин · осталось ${formatAge(limit - elapsedMs)}`;
}

/* ---------- Прошлые аварии в корпусе ---------- */

export interface PreviousEmergencies {
  /** Не больше пяти последних — для свёрнутого блока. */
  items: Ticket[];
  /** Сколько всего нашлось в загруженном списке заявок. */
  total: number;
  /** Сколько из них ещё не закрыто. */
  open: number;
  /** Время последней аварии (ISO) или `null`. */
  lastAt: string | null;
}

function buildingCore(place: Place | null | undefined): string | null {
  if (!place?.building) return null;
  const core = place.building.replace(/^корпус\s*/i, '').trim().toLowerCase();
  return core === '' ? null : core;
}

/** Аварии в том же корпусе, что и выбранная заявка, свежие сверху. */
export function previousEmergencies(
  tickets: readonly Ticket[],
  current: Pick<Ticket, 'id'> | null,
  placeOf: (ticketId: string) => Place | null | undefined,
): PreviousEmergencies {
  const target = buildingCore(current === null ? null : placeOf(current.id));
  if (current === null || target === null) {
    return { items: [], total: 0, open: 0, lastAt: null };
  }
  const list = sortByRecent(
    tickets.filter(
      (ticket) =>
        ticket.id !== current.id &&
        ticket.isEmergency &&
        buildingCore(placeOf(ticket.id)) === target,
    ),
  );
  return {
    items: list.slice(0, 5),
    total: list.length,
    open: list.filter((ticket) => ticket.status !== 'closed' && ticket.status !== 'cancelled').length,
    lastAt: list[0]?.createdAt ?? null,
  };
}

/* ---------- Кнопка «Назначить» ---------- */

export interface AssignmentState {
  allowed: boolean;
  /** Подсказка под кнопкой, когда назначить нельзя. `null` — можно или уже назначен. */
  hint: string | null;
}

/**
 * Назначение доступно диспетчеру на проверке. Заявка «ждёт ответа» — тоже можно:
 * диспетчер вправе забрать аварию в работу, не дожидаясь ответа заявителя.
 */
export function assignmentState(
  ticket: Pick<Ticket, 'status' | 'assigneeId'>,
  canConfirm: boolean,
): AssignmentState {
  if (ticket.assigneeId !== null) return { allowed: false, hint: null };
  if (!canConfirm) return { allowed: false, hint: 'Назначать может диспетчер' };
  if (ticket.status === 'in_review' || ticket.status === 'waiting_applicant') {
    return { allowed: true, hint: null };
  }
  return { allowed: false, hint: 'Назначение доступно на проверке заявки' };
}

/* ---------- Мелочи ---------- */

/** Русское склонение: 1 похожее, 2 похожих, 11 похожих. */
export function plural(count: number, one: string, few: string, many: string): string {
  const mod100 = Math.abs(Math.trunc(count)) % 100;
  const mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Время отметки шага «14:04» из миллисекунд. */
export function clockFromMs(ms: number | null | undefined): string | undefined {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return undefined;
  const date = new Date(ms);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
