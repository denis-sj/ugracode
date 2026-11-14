import { createElement, useEffect, useMemo, useState } from 'react';
import type { ComponentType, JSX } from 'react';
import type { MetaResponse, Ticket, TicketListResponse, User } from '@ugra/contracts';
import { PersonAvatar, ThemeToggle, useActionCounter } from '@ugra/ui';
import type { ApiClient, WebPageProps } from '@ugra/ui';
import { webModules } from '../web-modules';
import type { HashRoute } from '../router';
import { toHash } from '../router';
import { ProfilePage } from '../screens/ProfilePage';
import { NotificationsButton } from './NotificationsButton';
import { TabIcon } from './TabIcon';
import { firstTab, isTabPath, roleLabel, shortName, tabTitle, tabsForRole, type TabCounter } from './lib';

export interface AppShellProps {
  user: User;
  meta: MetaResponse;
  api: ApiClient;
  route: HashRoute;
  onLogout: () => void;
}

function Placeholder({ title }: { title: string }): JSX.Element {
  return (
    <section className="shell-placeholder ugra-card">
      <span className="shell-placeholder__eyebrow">{title}</span>
      <h2>Экран подключается из модуля</h2>
      <p>Модуль появится в этой же оболочке: шапка, токены и стили уже готовы.</p>
    </section>
  );
}

function emptyCounts(): Record<TabCounter, number> {
  return { queue: 0, incidents: 0, tasks: 0 };
}

/** Одна шапка на все роли (3.1) и отрисовка страницы текущего модуля. */
export function AppShell({ user, meta, api, route, onLogout }: AppShellProps): JSX.Element {
  const { track } = useActionCounter();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const tabs = tabsForRole(user.role);

  useEffect(() => {
    let alive = true;
    api
      .get<TicketListResponse>('/api/tickets?limit=200')
      .then((response) => {
        if (alive) setTickets(response.tickets);
      })
      .catch(() => {
        // Счётчики — подсказка в шапке; без них интерфейс работает.
      });
    return () => {
      alive = false;
    };
  }, [api, user.id]);

  const counts = useMemo(() => {
    const next = emptyCounts();
    for (const ticket of tickets) {
      const active = ticket.status !== 'closed' && ticket.status !== 'cancelled';
      if (
        active &&
        (ticket.status === 'new' ||
          ticket.status === 'ai_draft' ||
          ticket.status === 'waiting_applicant' ||
          ticket.status === 'in_review')
      ) {
        next.queue += 1;
      }
      if (active && ticket.isEmergency) next.incidents += 1;
      if (
        ticket.assigneeId === user.id &&
        (ticket.status === 'assigned' || ticket.status === 'in_progress')
      ) {
        next.tasks += 1;
      }
    }
    return next;
  }, [tickets, user.id]);

  const pages = useMemo(
    () => webModules.flatMap((module) => module.pages.map((page) => ({ moduleId: module.id, page }))),
    [],
  );
  const entry = pages.find(
    ({ page }) => page.path === route.path && (page.roles.length === 0 || page.roles.includes(user.role)),
  );

  const knownPath = isTabPath(user.role, route.path) || route.path === '/profile';
  const navigate = route.navigate;
  useEffect(() => {
    if (!entry && !knownPath) navigate(firstTab(user.role).path);
  }, [entry, knownPath, navigate, user.role]);

  const pageProps: WebPageProps = {
    user,
    meta,
    api,
    navigate: route.navigate,
    query: route.query,
    trackAction: track,
  };

  const PageComponent = entry?.page.component as ComponentType<WebPageProps> | null | undefined;
  const title = route.path === '/profile' ? 'Профиль' : tabTitle(user.role, route.path);

  return (
    <>
      <header className="shell-head">
        <button
          type="button"
          className="shell-brand"
          onClick={() => {
            track('navigate');
            route.navigate(firstTab(user.role).path);
          }}
        >
          <svg className="shell-brand__mark" width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
            <rect width="32" height="32" rx="9" fill="currentColor" />
            <g fill="var(--color-graphite-contrast)">
              <rect x="8" y="8" width="6" height="16" rx="2" />
              <rect x="18" y="8" width="6" height="6" rx="2" opacity="0.5" />
              <rect x="18" y="18" width="6" height="6" rx="2" />
            </g>
          </svg>
          Диспетчерская
        </button>

        <nav className="shell-menu ugra-liquid" aria-label="Разделы">
          {tabs.map((tab) => {
            const active = route.path === tab.path;
            const count = tab.counter ? counts[tab.counter] : 0;
            return (
              <a
                key={tab.path}
                href={toHash(tab.path)}
                className={active ? 'shell-tab shell-tab--on' : 'shell-tab'}
                aria-current={active ? 'page' : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  track('navigate');
                  route.navigate(tab.path);
                }}
              >
                <TabIcon name={tab.icon} />
                <span className="shell-tab__label">
                  {tab.label}
                  {count > 0 && (
                    <span
                      className={
                        tab.danger ? 'shell-tab__count shell-tab__count--danger' : 'shell-tab__count'
                      }
                    >
                      {count}
                    </span>
                  )}
                </span>
              </a>
            );
          })}
        </nav>

        <div className="shell-actions ugra-liquid">
          <ThemeToggle className="shell-dock__btn" />

          <NotificationsButton api={api} user={user} navigate={route.navigate} />

          <span className="shell-divider" aria-hidden="true" />

          <button
            type="button"
            className="shell-account"
            aria-label={`Профиль: ${user.fullName}`}
            title={`${user.fullName} — ${roleLabel(user.role)}`}
            onClick={() => {
              track('navigate');
              route.navigate('/profile');
            }}
          >
            <PersonAvatar name={user.fullName} size={36} />
            <span className="shell-account__text">
              <strong>{shortName(user.fullName)}</strong>
              <span>{roleLabel(user.role)}</span>
            </span>
          </button>
        </div>
      </header>

      <main className="shell-main">
        {PageComponent ? (
          createElement(PageComponent, { key: route.path, ...pageProps })
        ) : route.path === '/profile' ? (
          <ProfilePage user={user} meta={meta} api={api} onLogout={onLogout} />
        ) : (
          <Placeholder title={title} />
        )}
      </main>
    </>
  );
}
