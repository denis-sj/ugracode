import { describe, expect, it } from 'vitest';
import type { WebModule } from '@ugra/core/web';
import type { User } from '@ugra/contracts';
import {
  buildMenu,
  filterMenuByRole,
  groupMenuBySection,
  groupUsersByRole,
  initials,
  resolveMenuModuleIds,
} from '../src/lib';
import { normalizePath } from '../src/router';

function page(path: string, title: string, roles: string[], order: number, section = 'Работа') {
  return { path, title, roles, component: null, nav: { section, order } };
}

function module_(id: string, pages: WebModule['pages']): WebModule {
  return { id, pages, widgets: [], chatCards: [], reportViews: [] };
}

const modules: WebModule[] = [
  module_('clarify-chat', [page('/chat', 'Новое обращение', ['applicant', 'dispatcher'], 10)]),
  module_('dispatcher-review', [page('/queue', 'Очередь', ['dispatcher', 'manager'], 20)]),
  module_('reports', [page('/reports', 'Отчёты', ['manager'], 10, 'Аналитика')]),
];

describe('buildMenu', () => {
  it('собирает страницы включённых модулей и сортирует по разделам', () => {
    const menu = buildMenu(modules, ['clarify-chat', 'dispatcher-review', 'reports']);
    expect(menu.map((item) => item.path)).toEqual(['/chat', '/queue', '/reports']);
    expect(menu.map((item) => item.moduleId)).toEqual(['clarify-chat', 'dispatcher-review', 'reports']);
  });

  it('выключенный модуль не даёт пункта меню', () => {
    const menu = buildMenu(modules, ['clarify-chat']);
    expect(menu.map((item) => item.path)).toEqual(['/chat']);
  });

  it('на пустом реестре меню пустое', () => {
    expect(buildMenu([], [])).toEqual([]);
  });
});

describe('resolveMenuModuleIds', () => {
  it('пока сервер не знает ни одного модуля со страницами — показывает зарегистрированные', () => {
    expect(resolveMenuModuleIds(modules, ['example'])).toEqual(['clarify-chat', 'dispatcher-review', 'reports']);
  });

  it('когда сервер знает хотя бы один — фильтр строгий', () => {
    expect(resolveMenuModuleIds(modules, ['example', 'clarify-chat'])).toEqual(['clarify-chat']);
  });

  it('без веб-модулей список пуст', () => {
    expect(resolveMenuModuleIds([], ['example'])).toEqual([]);
  });
});

describe('filterMenuByRole', () => {
  const menu = buildMenu(modules);

  it('заявитель видит только свои страницы', () => {
    expect(filterMenuByRole(menu, 'applicant').map((item) => item.path)).toEqual(['/chat']);
  });

  it('диспетчер видит очередь и чат', () => {
    expect(filterMenuByRole(menu, 'dispatcher').map((item) => item.path)).toEqual(['/chat', '/queue']);
  });

  it('руководитель видит очередь и отчёты', () => {
    expect(filterMenuByRole(menu, 'manager').map((item) => item.path)).toEqual(['/queue', '/reports']);
  });

  it('страница без ролей доступна всем', () => {
    const open = buildMenu([module_('open', [page('/open', 'Открытая', [], 1)])]);
    expect(filterMenuByRole(open, 'applicant')).toHaveLength(1);
  });
});

describe('groupMenuBySection', () => {
  it('делит пункты по разделам, «Работа» раньше «Аналитики»', () => {
    const sections = groupMenuBySection(buildMenu(modules));
    expect(sections.map((section) => section.section)).toEqual(['Работа', 'Аналитика']);
    expect(sections[0]?.items).toHaveLength(2);
    expect(sections[1]?.items[0]?.path).toBe('/reports');
  });

  it('на пустом меню разделов нет', () => {
    expect(groupMenuBySection([])).toEqual([]);
  });
});

describe('groupUsersByRole', () => {
  const user = (id: string, role: User['role']): User => ({
    id,
    fullName: id,
    role,
    departmentId: null,
    position: '—',
  });

  it('группирует пользователей по ролям в порядке иерархии', () => {
    const groups = groupUsersByRole([user('d', 'dispatcher'), user('a', 'applicant'), user('d2', 'dispatcher')]);
    expect(groups.map((group) => group.role)).toEqual(['applicant', 'dispatcher']);
    expect(groups[1]?.users).toHaveLength(2);
  });

  it('пустой список — пустые группы', () => {
    expect(groupUsersByRole([])).toEqual([]);
  });
});

describe('normalizePath', () => {
  it('приводит hash к пути', () => {
    expect(normalizePath('#/chat/')).toBe('/chat');
    expect(normalizePath('chat')).toBe('/chat');
    expect(normalizePath('')).toBe('/');
    expect(normalizePath('#/')).toBe('/');
  });
});

describe('initials', () => {
  it('берёт первые буквы имени и фамилии', () => {
    expect(initials('Денис Соколов')).toBe('ДС');
    expect(initials('Анна')).toBe('А');
    expect(initials('  ')).toBe('?');
  });
});
