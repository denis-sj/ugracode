import type { DictionaryItem, EngineerInfo, Ticket } from '@ugra/contracts';

/**
 * Чистые функции экрана «Исполнители» (12): подписи подразделения и грейда,
 * загрузка с порогом перегруза, фильтр, сортировка и чипы навыков.
 * Всё, что требует DOM или сети, живёт в `ExecutorsPage.tsx`.
 */

/** Порог перегруза: 5 и больше открытых заявок — исполнитель перегружен. */
export const LOAD_THRESHOLD = 5;

/** Значение фильтра «все подразделения». */
export const ALL_DEPARTMENTS = 'all';

const GRADE_LABELS: Record<string, string> = {
  first_line: 'Первая линия',
  second_line: 'Вторая линия',
  lead: 'Ведущий специалист',
};

/** `first_line`/`second_line`/`lead` → человеческая подпись; неизвестный код не теряем. */
export function gradeLabel(level: EngineerInfo['level']): string {
  if (level === null || level === undefined) return 'Грейд не указан';
  if (typeof level === 'number') {
    return Number.isFinite(level) ? `${level}-й уровень` : 'Грейд не указан';
  }
  const code = level.trim();
  if (code === '') return 'Грейд не указан';
  return GRADE_LABELS[code] ?? code;
}

/** Подразделение из справочника `department`; неизвестный код остаётся кодом. */
export function departmentLabel(
  dictionaries: readonly DictionaryItem[],
  departmentId: string | null | undefined,
): string {
  if (!departmentId) return 'Подразделение не указано';
  const item = dictionaries.find((entry) => entry.dictionary === 'department' && entry.code === departmentId);
  return item?.label ?? departmentId;
}

/** Инициалы для аватара: «Игорь Лебедев» → «ИЛ»; пустое имя → «?». */
export function initials(fullName: string): string {
  const words = fullName
    .trim()
    .split(/\s+/)
    .filter((word) => word !== '');
  if (words.length === 0) return '?';
  return words
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
}

export type LoadTone = 'ok' | 'warn' | 'danger';

export interface LoadState {
  /** Сколько открытых заявок (неотрицательное целое). */
  count: number;
  threshold: number;
  /** Сколько делений шкалы закрашено, 0…threshold. */
  filled: number;
  /** Заполнение шкалы, 0…100. */
  percent: number;
  tone: LoadTone;
  overloaded: boolean;
  /** «3 из 5 задач». */
  text: string;
  /** «свободен» / «почти предел» / «перегруз». */
  hint: string;
}

function normalizeCount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

/** Загрузка исполнителя: шкала до порога, на пороге и выше — перегруз. */
export function loadState(openTickets: number, threshold: number = LOAD_THRESHOLD): LoadState {
  const count = normalizeCount(openTickets);
  const limit = Math.max(1, normalizeCount(threshold));
  const overloaded = count >= limit;
  const nearLimit = !overloaded && count >= limit - 1 && count > 0;
  return {
    count,
    threshold: limit,
    filled: Math.min(limit, count),
    percent: Math.min(100, Math.round((count / limit) * 100)),
    tone: overloaded ? 'danger' : nearLimit ? 'warn' : 'ok',
    overloaded,
    text: `${count} из ${limit} задач`,
    hint: overloaded ? 'перегруз' : nearLimit ? 'почти предел' : count === 0 ? 'свободен' : 'есть запас',
  };
}

export interface EngineerFilters {
  /** `all` или код подразделения. */
  department: string;
  onlyOnShift: boolean;
  query: string;
}

/** По умолчанию — кто на смене: диспетчеру нужны свободные люди, а не весь справочник. */
export const DEFAULT_ENGINEER_FILTERS: EngineerFilters = {
  department: ALL_DEPARTMENTS,
  onlyOnShift: true,
  query: '',
};

export interface EngineerSearchContext {
  /** Подпись подразделения — чтобы поиск находил «сети», а не только `dep-network`. */
  departmentLabel?: (departmentId: string | null) => string;
}

/** Фильтр карточек: подразделение, смена и поиск по имени, навыкам, корпусам, должности. */
export function filterEngineers(
  engineers: readonly EngineerInfo[],
  filters: EngineerFilters,
  context: EngineerSearchContext = {},
): EngineerInfo[] {
  const query = filters.query.trim().toLowerCase();
  return engineers.filter((engineer) => {
    if (filters.department !== ALL_DEPARTMENTS && engineer.departmentId !== filters.department) {
      return false;
    }
    if (filters.onlyOnShift && !engineer.onShift) return false;
    if (query === '') return true;
    const department = context.departmentLabel?.(engineer.departmentId) ?? engineer.departmentId ?? '';
    const haystack = [
      engineer.fullName,
      engineer.position ?? '',
      department,
      ...engineer.buildings,
      ...engineer.skills.map((skill) => `${skill.skill} ${skillLabel(skill.skill)}`),
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(query);
  });
}

/**
 * Сортировка карточек: перегруженные сверху, затем на смене, затем по числу
 * открытых заявок (больше — выше), в конце — по имени. Исходный массив не меняется.
 */
export function sortEngineers(
  engineers: readonly EngineerInfo[],
  threshold: number = LOAD_THRESHOLD,
): EngineerInfo[] {
  const limit = Math.max(1, normalizeCount(threshold));
  const overloadRank = (engineer: EngineerInfo): number => (engineer.openTickets >= limit ? 0 : 1);
  return [...engineers].sort((left, right) => {
    const byLoad = overloadRank(left) - overloadRank(right);
    if (byLoad !== 0) return byLoad;
    if (left.onShift !== right.onShift) return left.onShift ? -1 : 1;
    if (left.openTickets !== right.openTickets) return right.openTickets - left.openTickets;
    return left.fullName.localeCompare(right.fullName, 'ru');
  });
}

/** Коды навыков из `data/engineers.json` → человеческие подписи; неизвестный код остаётся кодом. */
const SKILL_LABELS: Record<string, string> = {
  windows: 'Windows',
  printer: 'Принтеры',
  consult: 'Консультации',
  '1c': '1С',
  network: 'Сети',
  access: 'Доступы',
  mfu: 'МФУ',
  peripheral: 'Периферия',
  software: 'ПО',
  cisco: 'Cisco',
  'wi-fi': 'Wi-Fi',
  vpn: 'VPN',
  email: 'Почта',
  server: 'Серверы',
  linux: 'Linux',
  backup: 'Резервные копии',
  hp: 'HP',
  pc: 'ПК',
  monitor: 'Мониторы',
  scanner: 'Сканеры',
  telephony: 'Телефония',
};

export function skillLabel(code: string): string {
  return SKILL_LABELS[code] ?? code;
}

export interface SkillChip {
  code: string;
  label: string;
  /** Уровень 1…5; значения вне диапазона подрезаются. */
  level: number;
}

/**
 * Навыки → чипы с уровнем: дубли по коду схлопываются (берём больший уровень),
 * чипы сортируются по уровню, затем по подписи.
 */
export function skillChips(skills: EngineerInfo['skills']): SkillChip[] {
  const byCode = new Map<string, SkillChip>();
  for (const skill of skills) {
    const code = skill.skill.trim();
    if (code === '') continue;
    const raw = Number.isFinite(skill.level) ? Math.round(skill.level) : 1;
    const level = Math.min(5, Math.max(1, raw));
    const previous = byCode.get(code);
    if (!previous || previous.level < level) {
      byCode.set(code, { code, label: skillLabel(code), level });
    }
  }
  return [...byCode.values()].sort(
    (left, right) => right.level - left.level || left.label.localeCompare(right.label, 'ru'),
  );
}

export type DeadlineTone = 'neutral' | 'warn' | 'danger';

export interface TaskDeadline {
  at: string;
  time: number;
  overdue: boolean;
  tone: DeadlineTone;
}

const WARN_BEFORE_MS = 15 * 60_000;

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

/** Ближайший срок задачи (реакция или решение); битые даты и их отсутствие дают `null`. */
export function taskDeadline(
  ticket: Pick<Ticket, 'reactDueAt' | 'slaDueAt'>,
  now: number,
): TaskDeadline | null {
  const candidates = [ticket.reactDueAt, ticket.slaDueAt]
    .map((at) => ({ at, time: parseTime(at) }))
    .filter((entry): entry is { at: string; time: number } => entry.at !== null && entry.time !== null);
  if (candidates.length === 0) return null;
  const nearest = candidates.reduce((left, right) => (right.time < left.time ? right : left));
  const left = nearest.time - now;
  const overdue = left < 0;
  return {
    at: nearest.at,
    time: nearest.time,
    overdue,
    tone: overdue ? 'danger' : left <= WARN_BEFORE_MS ? 'warn' : 'neutral',
  };
}
