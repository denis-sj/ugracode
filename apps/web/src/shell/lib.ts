import type { Role, User } from '@ugra/contracts';

/** Уведомление о назначении открывает конкретную задачу в кабинете исполнителя. */
export function notificationPath(role: Role, ticketId: string | null): string {
  if (role === 'engineer') return ticketId ? `/tasks?ticket=${encodeURIComponent(ticketId)}` : '/tasks';
  if (role === 'applicant') return '/tickets';
  return ticketId ? `/review?id=${encodeURIComponent(ticketId)}` : '/queue';
}

export type TabCounter = 'queue' | 'incidents' | 'tasks';

/** Иконка над подписью вкладки (вариант E «Вдавленное стекло с иконками»). */
export type TabIconName =
  | 'queue'
  | 'incidents'
  | 'phone'
  | 'journal'
  | 'executors'
  | 'chat'
  | 'tickets'
  | 'tasks'
  | 'kb'
  | 'measure'
  | 'dashboard'
  | 'reports'
  | 'quality';

export interface ShellTab {
  path: string;
  label: string;
  icon: TabIconName;
  /** Счётчик в шапке: очередь, аварии или мои задачи. */
  counter?: TabCounter;
  /** Красный счётчик — аварии. */
  danger?: boolean;
}

/** Вкладки шапки по ролям — ровно как в утверждённом дизайне (3.1). */
const TABS: Record<Role, readonly ShellTab[]> = {
  applicant: [
    { path: '/chat', label: 'Обращение', icon: 'chat' },
    { path: '/tickets', label: 'Мои заявки', icon: 'tickets' },
  ],
  dispatcher: [
    { path: '/queue', label: 'Очередь', icon: 'queue', counter: 'queue' },
    { path: '/incidents', label: 'Аварии', icon: 'incidents', counter: 'incidents', danger: true },
    { path: '/calls', label: 'Звонок', icon: 'phone' },
    { path: '/journal', label: 'Журнал', icon: 'journal' },
    { path: '/executors', label: 'Исполнители', icon: 'executors' },
  ],
  engineer: [
    { path: '/tasks', label: 'Мои задачи', icon: 'tasks', counter: 'tasks' },
    { path: '/knowledge', label: 'База знаний', icon: 'kb' },
  ],
  manager: [
    { path: '/dashboard', label: 'Дашборд', icon: 'dashboard' },
    { path: '/reports', label: 'Отчёты', icon: 'reports' },
    { path: '/quality', label: 'Качество ИИ', icon: 'quality' },
    { path: '/team', label: 'Сотрудники', icon: 'executors' },
  ],
  admin: [
    { path: '/queue', label: 'Очередь', icon: 'queue', counter: 'queue' },
    { path: '/incidents', label: 'Аварии', icon: 'incidents', counter: 'incidents', danger: true },
    { path: '/calls', label: 'Звонок', icon: 'phone' },
    { path: '/journal', label: 'Журнал', icon: 'journal' },
    { path: '/executors', label: 'Исполнители', icon: 'executors' },
    { path: '/dashboard', label: 'Дашборд', icon: 'dashboard' },
  ],
};

export function tabsForRole(role: Role): readonly ShellTab[] {
  return TABS[role];
}

export function firstTab(role: Role): ShellTab {
  const tabs = TABS[role];
  return tabs[0] ?? { path: '/', label: 'Главная', icon: 'dashboard' };
}

export function isTabPath(role: Role, path: string): boolean {
  return TABS[role].some((tab) => tab.path === path);
}

export function tabTitle(role: Role, path: string): string {
  return TABS[role].find((tab) => tab.path === path)?.label ?? 'Диспетчерская';
}

const ROLE_LABEL: Record<Role, string> = {
  applicant: 'Заявитель',
  dispatcher: 'Диспетчер',
  engineer: 'Инженер',
  manager: 'Руководитель',
  admin: 'Администратор',
};

export function roleLabel(role: Role): string {
  return ROLE_LABEL[role];
}

/** Роли на экране входа: по одной готовой учётке на каждую, администратор — отдельной ссылкой. */
export const LOGIN_ROLES: readonly Role[] = ['applicant', 'dispatcher', 'engineer', 'manager'];

/**
 * Учётка для карточки роли — одна, детерминированно.
 * В сиде учётки пронумерованы (`u-applicant-1`, `u-dispatcher-1`, …): младший номер и есть
 * типовая учётка демо. Порядок `/api/users` тут не годится — сервер отдаёт людей по алфавиту,
 * и заявителем оказался бы случайный человек. Нет номерных — берём первую по роли.
 * Гость и звонок ИИ-оператору номеров не имеют, поэтому на карточки не попадают: они в «Ещё».
 */
export function pickRoleUser(users: readonly User[], role: Role): User | null {
  const ofRole = users.filter((user) => user.role === role);
  let picked: User | null = null;
  let pickedNumber = Number.POSITIVE_INFINITY;
  for (const user of ofRole) {
    const match = /^u-[a-z]+-(\d+)$/.exec(user.id);
    const rawNumber = match?.[1];
    if (rawNumber === undefined) continue;
    const number = Number(rawNumber);
    if (number < pickedNumber) {
      picked = user;
      pickedNumber = number;
    }
  }
  return picked ?? ofRole[0] ?? null;
}

/** Короткая подпись в шапке: «Ольга Ветрова» → «Ольга В.» (как в макете). */
export function shortName(fullName: string | null | undefined): string {
  const words = (fullName ?? '')
    .trim()
    .split(/\s+/)
    .filter((word) => word !== '');
  if (words.length === 0) return 'Без имени';
  const [first = ''] = words;
  if (words.length === 1) return first;
  const last = words[words.length - 1] ?? '';
  return `${first} ${last.charAt(0).toUpperCase()}.`;
}

/** Инициалы для круглого аватара: «Денис Соколов» → «ДС», «Роман» → «РО», пусто → «?». */
export function initials(fullName: string | null | undefined): string {
  const words = (fullName ?? '')
    .trim()
    .split(/\s+/)
    .filter((word) => word !== '');
  if (words.length === 0) return '?';
  if (words.length === 1) {
    const [only = ''] = words;
    return (only.slice(0, 2) || '?').toUpperCase();
  }
  const first = words[0] ?? '';
  const last = words[words.length - 1] ?? '';
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
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

/** Время уведомления так, как в макете: «10 мин назад», «вчера, 16:20», «8 нояб.». */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const diffMs = now.getTime() - date.getTime();
  if (diffMs >= 0 && diffMs < 60_000) return 'только что';
  if (diffMs >= 0 && diffMs < 3_600_000) {
    const minutes = Math.max(1, Math.floor(diffMs / 60_000));
    return `${minutes} мин назад`;
  }
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDiff = Math.round((startOfToday - startOfDate) / 86_400_000);
  if (dayDiff === 0) return `сегодня, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (dayDiff === 1) return `вчера, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`;
}

/** Поиск по истории: номер, название или статус. */
export function matchesQuery(query: string, ...values: ReadonlyArray<string | null | undefined>): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  return values.some((value) => (value ?? '').toLowerCase().includes(needle));
}
