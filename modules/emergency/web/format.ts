import type { Channel, EmergencyVerdict, Ticket, TicketField, TicketStatus } from '@ugra/contracts';

/**
 * Чистые функции экрана «Авария и массовость» (дизайн 4.5).
 *
 * Здесь всё, что можно посчитать без React и без DOM: место из полей заявки, «почему авария»
 * из разбора, таймер с момента обращения, выбор похожих заявок (категория + корпус за окно),
 * столбики по минутам с порогом и хронология из событий. Цвета и раскладку задаёт модуль CSS.
 */

/** Порог массовости: столько похожих обращений за окно — уже массовый сбой. */
export const MASS_THRESHOLD = 3;
/** Окно массовости, минуты. */
export const MASS_WINDOW_MINUTES = 15;

export interface Place {
  building: string | null;
  cabinet: string | null;
  floor: string | null;
}

const EMPTY_PLACE: Place = { building: null, cabinet: null, floor: null };

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    : [];
}

/* ---------- Место: корпус, кабинет, этаж ---------- */

/**
 * Корпус, кабинет и этаж из полей заявки. Пустые и «null»-значения считаются отсутствующими:
 * в списке лучше прочерк, чем «каб. null».
 */
export function placeFromFields(fields: readonly TicketField[] | null | undefined): Place {
  if (!fields || fields.length === 0) return EMPTY_PLACE;
  const read = (key: string): string | null => {
    const field = fields.find((entry) => entry.fieldKey === key);
    return asString(field?.value);
  };
  return { building: read('building'), cabinet: read('cabinet'), floor: read('floor') };
}

function buildingCore(value: string | null): string | null {
  if (value === null) return null;
  const core = value.replace(/^корпус\s*/i, '').trim().toLowerCase();
  return core === '' ? null : core;
}

/** «Корпус А · каб. 105» — без выдуманных частей; пусто — прочерк. */
export function placeLabel(place: Place | null | undefined): string {
  if (!place) return '—';
  const parts: string[] = [];
  const building = asString(place.building);
  if (building !== null) parts.push(/^корпус\s/i.test(building) ? building : `Корпус ${building}`);
  const floor = asString(place.floor);
  if (floor !== null) parts.push(/этаж/i.test(floor) ? floor : `${floor} этаж`);
  const cabinet = asString(place.cabinet);
  if (cabinet !== null) parts.push(`каб. ${cabinet}`);
  return parts.length === 0 ? '—' : parts.join(' · ');
}

/* ---------- Вердикт аварии из разбора ---------- */

const SIGN_LABELS: Record<string, string> = {
  smoke: 'дым',
  burning_smell: 'запах горелого',
  sparks: 'искры',
  fire: 'пожар',
  water_leak: 'протечка',
  gas_smell: 'запах газа',
  power_outage: 'отключение питания',
  network_outage: 'отказ сети',
};

/** Подпись признака; неизвестный код показываем как есть, а не прячем. */
export function signLabel(sign: string): string {
  return SIGN_LABELS[sign] ?? sign;
}

/**
 * Терпимое чтение `analysis.emergency` из `GET /api/tickets/:id/analysis`.
 * Разбор без вердикта или битые поля не роняют экран: возвращаем `null`.
 */
export function readEmergencyVerdict(analysis: unknown): EmergencyVerdict | null {
  const raw = asRecord(asRecord(analysis)?.emergency);
  if (!raw) return null;

  const level = raw.level;
  if (level !== 'none' && level !== 'suspected' && level !== 'confirmed') return null;

  const signs = Array.isArray(raw.signs)
    ? raw.signs.flatMap((item) => {
        const sign = asRecord(item);
        const code = asString(sign?.sign);
        if (code === null) return [];
        return [{ sign: code, quote: asString(sign?.quote) ?? '' }];
      })
    : [];

  const confidence = typeof raw.confidence === 'number' && Number.isFinite(raw.confidence) ? raw.confidence : 0;

  return {
    level,
    signs,
    confidence: Math.min(1, Math.max(0, confidence)),
    rulesMatched: asStringArray(raw.rulesMatched),
    checklist: asStringArray(raw.checklist),
    notifyUserIds: asStringArray(raw.notifyUserIds),
  };
}

/**
 * «Почему авария» одной фразой: признаки из текста, правила регламента и честный случай,
 * когда вердикта нет. Уверенность показывается отдельно и здесь не дублируется.
 */
export function emergencyReason(verdict: EmergencyVerdict | null | undefined): string {
  if (!verdict || verdict.level === 'none') {
    return 'Разбор не нашёл признаков аварии — проверьте текст обращения вручную.';
  }

  const labels = [...new Set(verdict.signs.map((sign) => signLabel(sign.sign)))];
  const parts: string[] = [];
  if (labels.length > 0) parts.push(`Признаки: ${labels.map((label) => `«${label}»`).join(', ')}`);
  if (verdict.rulesMatched.length > 0) parts.push(`правила: ${verdict.rulesMatched.join(', ')}`);

  if (parts.length === 0) {
    return verdict.level === 'confirmed'
      ? 'Авария подтверждена правилами регламента.'
      : 'Заявка помечена аварией, но признаков в тексте разбор не нашёл — проверьте вручную.';
  }

  const prefix = verdict.level === 'confirmed' ? '' : 'Под вопросом — ';
  return `${prefix}${parts.join(' · ')}.`;
}

/** Уровень вердикта → короткая подпись для плашки/бейджа. */
export function emergencyLevelLabel(level: EmergencyVerdict['level'] | null | undefined): string {
  if (level === 'confirmed') return 'Авария';
  if (level === 'suspected') return 'Под вопросом';
  return 'Аварии нет';
}

/* ---------- Таймер и время ---------- */

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Прошедшее время как на макете: «0:07», «12:40», «1:03:09». Мусор и будущее — ноль. */
export function formatTimer(ms: number): string {
  const safe = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** Возраст заявки словами: «< 1 мин», «12 мин», «2 ч 5 мин». */
export function formatAge(ms: number): string {
  const safe = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 60_000)) : 0;
  if (safe < 1) return '< 1 мин';
  if (safe < 60) return `${safe} мин`;
  const hours = Math.floor(safe / 60);
  const minutes = safe % 60;
  return minutes === 0 ? `${hours} ч` : `${hours} ч ${minutes} мин`;
}

export interface IncidentTimer {
  /** Миллисекунды с момента обращения (0 — даты нет или она в будущем). */
  ms: number;
  /** «12:40» */
  clock: string;
  /** «12 мин» */
  age: string;
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

/** Таймер с момента обращения: одна точка правды для шапки, списка и тестов. */
export function incidentTimer(from: string | null | undefined, now: number = Date.now()): IncidentTimer {
  const startedAt = parseTime(from);
  const ms = startedAt === null || !Number.isFinite(now) ? 0 : Math.max(0, now - startedAt);
  return { ms, clock: formatTimer(ms), age: formatAge(ms) };
}

/** Время события «14:30»; битая дата — прочерк. */
export function eventTime(iso: string | null | undefined): string | undefined {
  const time = parseTime(iso);
  if (time === null) return undefined;
  const date = new Date(time);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/* ---------- Список аварий ---------- */

/** Аварийные заявки: свежие сверху (внутри одного времени — по номеру). */
export function sortByRecent<T extends Pick<Ticket, 'createdAt' | 'number'>>(tickets: readonly T[]): T[] {
  return [...tickets].sort((left, right) => {
    const leftAt = parseTime(left.createdAt) ?? 0;
    const rightAt = parseTime(right.createdAt) ?? 0;
    return rightAt - leftAt || left.number.localeCompare(right.number);
  });
}

/* ---------- Похожие заявки и массовость ---------- */

export interface SimilarOptions {
  /** Текущее время, мс. */
  now?: number;
  /** Окно, минуты. */
  windowMinutes?: number;
  /** Закрытые и отменённые не считаем: массовость — про открытые обращения. */
  activeOnly?: boolean;
  /** Включать саму заявку в счётчик (по макету — да). */
  includeTarget?: boolean;
}

function isActive(status: TicketStatus): boolean {
  return status !== 'closed' && status !== 'cancelled';
}

/**
 * Похожие обращения для блока «Похоже на массовый сбой»: та же категория и тот же корпус
 * за окно времени. Нет категории или корпуса — сравнить не с чем, возвращаем пустой список.
 * Это повторяет правило массовости из спецификации (код, не модель).
 */
export function similarTickets(
  tickets: readonly Ticket[],
  target: Pick<Ticket, 'id' | 'category'> | null | undefined,
  placeOf: (ticketId: string) => Place | null | undefined,
  options: SimilarOptions = {},
): Ticket[] {
  if (!target || !target.category) return [];
  const targetBuilding = buildingCore(placeOf(target.id)?.building ?? null);
  if (targetBuilding === null) return [];

  const now = options.now ?? Date.now();
  const windowMs = Math.max(1, options.windowMinutes ?? MASS_WINDOW_MINUTES) * 60_000;
  const activeOnly = options.activeOnly ?? true;
  const includeTarget = options.includeTarget ?? true;

  return tickets.filter((ticket) => {
    if (!includeTarget && ticket.id === target.id) return false;
    if (activeOnly && !isActive(ticket.status)) return false;
    if (ticket.category !== target.category) return false;
    if (buildingCore(placeOf(ticket.id)?.building ?? null) !== targetBuilding) return false;
    const createdAt = parseTime(ticket.createdAt);
    if (createdAt === null) return false;
    return createdAt >= now - windowMs && createdAt <= now;
  });
}

export interface MassPoint {
  /** Ключ для React: начало минуты в ISO. */
  key: string;
  /** Подпись оси: «10:50». */
  label: string;
  /** Похожих обращений к концу этой минуты (накопительно). */
  count: number;
}

export interface MassTimeline {
  points: MassPoint[];
  /** Сколько похожих всего за окно. */
  total: number;
  /** Верхняя граница шкалы: не меньше порога, чтобы линия была видна. */
  max: number;
  threshold: number;
  /** Порог пройден — можно объявлять инцидент. */
  thresholdMet: boolean;
}

/**
 * Столбики по минутам: накопительный счётчик похожих за окно. Так пунктирная линия порога
 * читается буквально — когда столбик её пересёк, похожих стало не меньше порога.
 */
export function massTimeline(
  tickets: readonly Pick<Ticket, 'createdAt'>[],
  now: number = Date.now(),
  options: { windowMinutes?: number; threshold?: number } = {},
): MassTimeline {
  const windowMinutes = Math.max(1, Math.round(options.windowMinutes ?? MASS_WINDOW_MINUTES));
  const threshold = Math.max(1, Math.round(options.threshold ?? MASS_THRESHOLD));
  const safeNow = Number.isFinite(now) ? now : Date.now();
  const start = safeNow - windowMinutes * 60_000;

  const times = tickets
    .flatMap((ticket) => {
      const time = parseTime(ticket.createdAt);
      return time === null ? [] : [time];
    })
    .sort((left, right) => left - right);

  const points: MassPoint[] = [];
  for (let index = 0; index < windowMinutes; index += 1) {
    const bucketStart = start + index * 60_000;
    const bucketEnd = bucketStart + 60_000;
    const count = times.filter((time) => time >= start && time < bucketEnd).length;
    const date = new Date(bucketStart);
    points.push({
      key: new Date(bucketStart).toISOString(),
      label: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
      count,
    });
  }

  const total = times.filter((time) => time >= start && time <= safeNow).length;
  return {
    points,
    total,
    max: Math.max(threshold, total, 1),
    threshold,
    thresholdMet: total >= threshold,
  };
}

/* ---------- Цитата с признаками ---------- */

export interface QuoteSegment {
  text: string;
  strong: boolean;
}

/**
 * Делит текст обращения на обычные и выделенные фрагменты по цитатам признаков.
 * Регистр не важен; односимвольные и пустые цитаты пропускаются, чтобы не подсветить всё подряд.
 */
export function quoteSegments(text: string, quotes: ReadonlyArray<string | null | undefined>): QuoteSegment[] {
  if (text === '') return [];
  const needles = [...new Set(quotes.map((quote) => quote?.trim().toLowerCase() ?? ''))]
    .filter((quote) => quote.length >= 3)
    .sort((left, right) => right.length - left.length);
  if (needles.length === 0) return [{ text, strong: false }];

  const lower = text.toLowerCase();
  const ranges: Array<{ start: number; end: number }> = [];
  for (const needle of needles) {
    let index = lower.indexOf(needle);
    while (index !== -1) {
      ranges.push({ start: index, end: index + needle.length });
      index = lower.indexOf(needle, index + needle.length);
    }
  }
  if (ranges.length === 0) return [{ text, strong: false }];

  ranges.sort((left, right) => left.start - right.start || right.end - left.end);
  const merged: Array<{ start: number; end: number }> = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }

  const segments: QuoteSegment[] = [];
  let cursor = 0;
  for (const range of merged) {
    if (range.start > cursor) segments.push({ text: text.slice(cursor, range.start), strong: false });
    segments.push({ text: text.slice(range.start, range.end), strong: true });
    cursor = range.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), strong: false });
  return segments;
}

/* ---------- Хронология ---------- */

export type IncidentEventTone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger' | 'info' | 'muted';

export interface IncidentEventItem {
  id: string;
  title: string;
  description?: string;
  at?: string;
  tone: IncidentEventTone;
}

const EVENT_TITLES: Record<string, string> = {
  'appeal.created': 'Обращение создано',
  'analysis.started': 'Разбор запущен',
  'analysis.completed': 'Разбор завершён',
  'ticket.field.set': 'Поле заполнено',
  'ticket.field.corrected': 'Поле исправлено человеком',
  'ticket.confirmed': 'Заявка подтверждена',
  'ticket.assigned': 'Назначен исполнитель',
  'ticket.status.changed': 'Статус изменён',
  'ticket.deadline.extended': 'Срок продлён',
  'ticket.returned': 'Заявка возвращена диспетчеру',
  'message.sent': 'Сообщение заявителю',
  'emergency.detected': 'Признана авария',
};

const STATUS_LABELS: Record<TicketStatus, string> = {
  new: 'новая',
  ai_draft: 'разбор ИИ',
  waiting_applicant: 'ждёт ответа',
  in_review: 'на проверке',
  assigned: 'назначена',
  in_progress: 'в работе',
  resolved: 'решена',
  closed: 'закрыта',
  cancelled: 'отменена',
};

const MAX_DESCRIPTION = 140;

function trim(text: string): string {
  return text.length <= MAX_DESCRIPTION ? text : `${text.slice(0, MAX_DESCRIPTION - 1)}…`;
}

function eventTone(type: string): IncidentEventTone {
  if (type === 'emergency.detected') return 'danger';
  if (type === 'ticket.field.corrected' || type === 'ticket.returned') return 'warn';
  if (type === 'ticket.confirmed' || type === 'ticket.assigned' || type === 'analysis.completed') return 'ok';
  if (type.startsWith('analysis.')) return 'accent';
  if (type === 'ticket.status.changed') return 'info';
  return 'neutral';
}

function emergencyDescription(payload: Record<string, unknown>): string | undefined {
  const level = asString(payload.level);
  const signs = Array.isArray(payload.signs)
    ? payload.signs.flatMap((item) => {
        const record = asRecord(item);
        const sign = asString(record?.sign);
        return sign === null ? [] : [signLabel(sign)];
      })
    : [];
  const rules = asStringArray(payload.rules);
  const parts: string[] = [];
  if (level === 'confirmed') parts.push('подтверждена');
  else if (level === 'suspected') parts.push('под вопросом');
  if (signs.length > 0) parts.push(`признаки: ${[...new Set(signs)].join(', ')}`);
  if (rules.length > 0) parts.push(`правила: ${rules.join(', ')}`);
  return parts.length === 0 ? undefined : parts.join(' · ');
}

/** Описание события из payload: только известные поля, без «[object Object]». */
export function eventDescription(
  type: string,
  payload: unknown,
  resolveUser: (id: string) => string | null = () => null,
): string | undefined {
  const data = asRecord(payload);
  if (!data) return undefined;

  if (type === 'emergency.detected') return emergencyDescription(data);

  if (type === 'ticket.status.changed') {
    const to = asString(data.to);
    const status = to && to in STATUS_LABELS ? STATUS_LABELS[to as TicketStatus] : to;
    return status ? `→ ${status}` : undefined;
  }

  if (type === 'ticket.assigned') {
    const assigneeId = asString(data.assigneeId);
    if (assigneeId === null) return undefined;
    return resolveUser(assigneeId) ?? assigneeId;
  }

  const text = asString(data.text) ?? asString(data.body) ?? asString(data.reason);
  if (text !== null) return trim(text);

  const fieldKey = asString(data.fieldKey);
  if (fieldKey !== null) {
    const value = asString(data.value);
    return value === null ? fieldKey : `${fieldKey}: ${value}`;
  }

  const stepId = asString(data.stepId);
  if (stepId !== null) return stepId;

  return undefined;
}

export interface TimelineOptions {
  resolveUser?: (id: string) => string | null;
}

/**
 * События заявки → хронология: по возрастанию времени, авария — красной точкой.
 * Неизвестный тип показываем как есть, битые события не роняют список.
 */
export function timelineItems(events: readonly unknown[], options: TimelineOptions = {}): IncidentEventItem[] {
  const items = events.flatMap((raw, index) => {
    const event = asRecord(raw);
    if (!event) return [];
    const type = asString(event.type) ?? 'event';
    const at = asString(event.at) ?? undefined;
    return [
      {
        id: asString(event.id) ?? `event-${index}`,
        title: EVENT_TITLES[type] ?? type,
        description: eventDescription(type, event.payload, options.resolveUser),
        at: eventTime(at),
        time: parseTime(at),
        tone: eventTone(type),
      },
    ];
  });

  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const leftTime = left.item.time ?? Number.POSITIVE_INFINITY;
      const rightTime = right.item.time ?? Number.POSITIVE_INFINITY;
      return leftTime - rightTime || left.index - right.index;
    })
    .map(({ item }) => ({
      id: item.id,
      title: item.title,
      description: item.description,
      at: item.at,
      tone: item.tone,
    }));
}

/* ---------- Прочее ---------- */

/** Канал обращения словами. */
export function channelLabel(channel: Channel | null | undefined): string {
  switch (channel) {
    case 'phone':
      return 'звонок';
    case 'email':
      return 'почта';
    case 'screenshot':
      return 'скриншот';
    case 'chat':
      return 'чат';
    default:
      return 'канал не указан';
  }
}

/** Номер инцидента для локальной имитации: «И-0415» из номера заявки. */
export function incidentNumber(ticketNumber: string): string {
  const digits = ticketNumber.replace(/\D/g, '');
  if (digits === '') return 'И-0001';
  return `И-${digits.slice(-4).padStart(4, '0')}`;
}
