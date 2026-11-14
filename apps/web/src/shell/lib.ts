import type { Role } from '@ugra/contracts';

export type TabCounter = 'queue' | 'incidents' | 'tasks';

export interface ShellTab {
  path: string;
  label: string;
  /** Счётчик в шапке: очередь, аварии или мои задачи. */
  counter?: TabCounter;
  /** Красный счётчик — аварии. */
  danger?: boolean;
}

/** Вкладки шапки по ролям — ровно как в утверждённом дизайне (3.1). */
const TABS: Record<Role, readonly ShellTab[]> = {
  applicant: [
    { path: '/chat', label: 'Обращение' },
    { path: '/tickets', label: 'Мои заявки' },
  ],
  dispatcher: [
    { path: '/queue', label: 'Очередь', counter: 'queue' },
    { path: '/incidents', label: 'Аварии', counter: 'incidents', danger: true },
    { path: '/journal', label: 'Журнал' },
    { path: '/executors', label: 'Исполнители' },
  ],
  engineer: [
    { path: '/tasks', label: 'Мои задачи', counter: 'tasks' },
    { path: '/knowledge', label: 'База знаний' },
  ],
  manager: [
    { path: '/dashboard', label: 'Дашборд' },
    { path: '/reports', label: 'Отчёты' },
    { path: '/quality', label: 'Качество ИИ' },
  ],
  admin: [
    { path: '/queue', label: 'Очередь', counter: 'queue' },
    { path: '/incidents', label: 'Аварии', counter: 'incidents', danger: true },
    { path: '/journal', label: 'Журнал' },
    { path: '/executors', label: 'Исполнители' },
    { path: '/dashboard', label: 'Дашборд' },
  ],
};

export function tabsForRole(role: Role): readonly ShellTab[] {
  return TABS[role];
}

export function firstTab(role: Role): ShellTab {
  const tabs = TABS[role];
  return tabs[0] ?? { path: '/', label: 'Главная' };
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
