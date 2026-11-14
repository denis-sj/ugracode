import type { Role, User } from '@ugra/contracts';
import type { WebModule } from '@ugra/core/web';

/** Чистые функции оболочки: меню по роли, группировка пользователей. */

export const ROLE_ORDER: readonly Role[] = ['applicant', 'dispatcher', 'engineer', 'manager', 'admin'];

export const ROLE_LABELS: Record<Role, string> = {
  applicant: 'Заявитель',
  dispatcher: 'Диспетчер',
  engineer: 'Инженер',
  manager: 'Руководитель',
  admin: 'Администратор',
};

export const ROLE_HINTS: Record<Role, string> = {
  applicant: 'Пишет обращение и отвечает на вопросы',
  dispatcher: 'Проверяет поля и назначает исполнителя',
  engineer: 'Берёт заявки в работу и записывает результат',
  manager: 'Смотрит отчёты, журнал и качество',
  admin: 'Настраивает пороги и справочники',
};

export const SECTION_ORDER: readonly string[] = ['Работа', 'Аналитика', 'Прочее'];

export interface MenuItem {
  id: string;
  path: string;
  title: string;
  icon?: string;
  roles: readonly string[];
  section: string;
  order: number;
  moduleId: string;
}

export interface MenuSection {
  section: string;
  items: MenuItem[];
}

function sectionRank(section: string): number {
  const index = SECTION_ORDER.indexOf(section);
  return index === -1 ? SECTION_ORDER.length : index;
}

/**
 * Какие веб-модули показывать в меню.
 *
 * Правило: страница видна, если модуль включён на сервере (`/api/meta`). Пока серверные части
 * модулей ещё не влиты (в мете нет ни одного модуля со страницами), оболочка показывает
 * зарегистрированные веб-страницы — иначе интерфейс нельзя проверить на чекпоинте.
 * Как только сервер знает хотя бы один такой модуль, фильтр становится строгим и `FEATURES_OFF` работает.
 */
export function resolveMenuModuleIds(modules: readonly WebModule[], serverModuleIds: readonly string[]): string[] {
  const withPages = modules.filter((module) => module.pages.length > 0).map((module) => module.id);
  const known = withPages.filter((id) => serverModuleIds.includes(id));
  return known.length > 0 ? known : withPages;
}

/** Собирает меню из страниц веб-модулей. Модули, которых нет в списке, не попадают в меню. */
export function buildMenu(modules: readonly WebModule[], enabledModuleIds?: readonly string[]): MenuItem[] {
  const enabled = enabledModuleIds ? new Set(enabledModuleIds) : null;
  return modules
    .filter((module) => !enabled || enabled.has(module.id))
    .flatMap((module) =>
      module.pages.map((page) => ({
        id: `${module.id}:${page.path}`,
        path: page.path,
        title: page.title,
        icon: page.icon,
        roles: page.roles,
        section: page.nav?.section ?? 'Прочее',
        order: page.nav?.order ?? 100,
        moduleId: module.id,
      })),
    )
    .sort(
      (left, right) =>
        sectionRank(left.section) - sectionRank(right.section) ||
        left.order - right.order ||
        left.title.localeCompare(right.title, 'ru'),
    );
}

/** Меню по роли: страница без ролей доступна всем. */
export function filterMenuByRole(items: readonly MenuItem[], role: Role): MenuItem[] {
  return items.filter((item) => item.roles.length === 0 || item.roles.includes(role));
}

/** Группировка меню по разделам с сохранением порядка разделов. */
export function groupMenuBySection(items: readonly MenuItem[]): MenuSection[] {
  const sections = new Map<string, MenuItem[]>();
  for (const item of items) {
    const bucket = sections.get(item.section) ?? [];
    bucket.push(item);
    sections.set(item.section, bucket);
  }
  return [...sections.entries()]
    .map(([section, sectionItems]) => ({ section, items: sectionItems }))
    .sort((left, right) => sectionRank(left.section) - sectionRank(right.section));
}

export interface UserGroup {
  role: Role;
  label: string;
  users: User[];
}

/** Пользователи по ролям для экрана входа: пустые роли не показываем. */
export function groupUsersByRole(users: readonly User[]): UserGroup[] {
  return ROLE_ORDER.map((role) => ({
    role,
    label: ROLE_LABELS[role],
    users: users.filter((user) => user.role === role),
  })).filter((group) => group.users.length > 0);
}

/** Инициалы для аватара: «Денис Соколов» → «ДС». */
export function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.charAt(0) ?? '?';
  const second = parts[1]?.charAt(0) ?? '';
  return `${first}${second}`.toUpperCase();
}

/** Приветствие по времени суток. */
export function greeting(now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour < 5) return 'Доброй ночи';
  if (hour < 12) return 'Доброе утро';
  if (hour < 18) return 'Добрый день';
  return 'Добрый вечер';
}
