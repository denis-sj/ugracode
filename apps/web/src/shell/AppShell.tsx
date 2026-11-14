import type { MetaResponse, User } from '@ugra/contracts';
import type { ComponentType, JSX } from 'react';
import { useEffect, useMemo } from 'react';
import { Slot, useActionCounter } from '@ugra/ui';
import type { SlotWidget, WebPageProps } from '@ugra/ui';
import { api } from '../api';
import { buildMenu, filterMenuByRole, groupMenuBySection, initials, resolveMenuModuleIds, ROLE_LABELS } from '../lib';
import { useHashRoute } from '../router';
import { webModules } from '../web-modules';
import { HomeScreen } from '../screens/HomeScreen';

export interface AppShellProps {
  user: User;
  meta: MetaResponse;
  onSignOut: () => void;
}

/** Оболочка: шапка, меню по роли, слоты виджетов и страницы веб-модулей. */
export function AppShell({ user, meta, onSignOut }: AppShellProps): JSX.Element {
  const { path, navigate } = useHashRoute();
  const counter = useActionCounter();

  const enabledIds = useMemo(() => meta.modules.map((module) => module.id), [meta.modules]);
  const menuIds = useMemo(() => resolveMenuModuleIds(webModules, enabledIds), [enabledIds]);

  const menu = useMemo(
    () => filterMenuByRole(buildMenu(webModules, menuIds), user.role),
    [menuIds, user.role],
  );
  const sections = useMemo(() => groupMenuBySection(menu), [menu]);

  const widgets = useMemo<SlotWidget[]>(
    () =>
      webModules
        .filter((module) => enabledIds.includes(module.id))
        .flatMap((module) => module.widgets)
        .map((widget) => ({
          slot: widget.slot,
          id: widget.id,
          order: widget.order,
          roles: widget.roles,
          component: widget.component,
        })),
    [enabledIds],
  );

  const pages = useMemo(
    () =>
      webModules
        .filter((module) => menuIds.includes(module.id))
        .flatMap((module) => module.pages.map((page) => ({ moduleId: module.id, page }))),
    [menuIds],
  );

  const current = pages.find((entry) => entry.page.path === path && menu.some((item) => item.path === entry.page.path));

  useEffect(() => {
    // Переходы считаем отдельно от кликов по ссылкам: так К4 видит навигацию.
    counter.track('navigate');
  }, [path]);

  useEffect(() => {
    if (path === '/') return;
    const known = menu.some((item) => item.path === path);
    if (!known) navigate(menu[0]?.path ?? '/');
  }, [path, menu, navigate]);

  const PageComponent = current ? (current.page.component as ComponentType<WebPageProps>) : null;

  const pageProps: WebPageProps = {
    user,
    meta,
    api,
    navigate,
    trackAction: counter.track,
  };

  return (
    <div className="shell">
      <header className="shell__topbar">
        <button type="button" className="shell__brand" onClick={() => navigate('/')}>
          <span className="shell__brand-mark" aria-hidden="true">
            ✳
          </span>
          <span className="shell__brand-text">
            <span className="shell__brand-title">Диспетчерская с ИИ</span>
            <span className="shell__brand-sub">Газпром трансгаз Сургут</span>
          </span>
        </button>

        <nav className="shell__nav" aria-label="Разделы">
          {sections.map((section) => (
            <div className="shell__nav-section" key={section.section}>
              <span className="shell__nav-label">{section.section}</span>
              {section.items.map((item) => (
                <a
                  key={item.id}
                  className={`shell__nav-link${item.path === path ? ' shell__nav-link--active' : ''}`}
                  href={`#${item.path}`}
                  aria-current={item.path === path ? 'page' : undefined}
                >
                  {item.icon && (
                    <span className="shell__nav-icon" aria-hidden="true">
                      {item.icon}
                    </span>
                  )}
                  {item.title}
                </a>
              ))}
            </div>
          ))}
          {menu.length === 0 && <span className="ugra-dim shell__nav-empty">Нет страниц для роли</span>}
        </nav>

        <div className="shell__right">
          <Slot name="shell.topbar" widgets={widgets} role={user.role} />

          <span className="shell__counter" title="Счётчик действий пользователя — замер К4">
            <span className="shell__counter-label">Действий</span>
            <strong className="shell__counter-value">{counter.count}</strong>
          </span>

          <div className="shell__user">
            <span className="shell__avatar" aria-hidden="true">
              {initials(user.fullName)}
            </span>
            <span className="shell__user-text">
              <span className="shell__user-name">{user.fullName}</span>
              <span className="shell__user-role">{ROLE_LABELS[user.role]}</span>
            </span>
            <button type="button" className="shell__switch" onClick={onSignOut} title="Вернуться к выбору пользователя">
              Сменить
            </button>
          </div>
        </div>
      </header>

      <main className="shell__main">
        {PageComponent ? (
          <PageComponent {...pageProps} />
        ) : (
          <HomeScreen user={user} meta={meta} menu={menu} widgets={widgets} actions={counter.count} />
        )}
      </main>
    </div>
  );
}
