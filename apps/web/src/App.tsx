import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { MetaResponse, SessionResponse, User, UsersResponse } from '@ugra/contracts';
import { ThemeToggle, useBlockMotion } from '@ugra/ui';
import { PhoneCallPage } from '../../../modules/voice-call/web/PhoneCallPage';
import { isCallPath } from '../../../modules/voice-call/web/call-flow';
import { ApiError, api } from './api';
import { LoginScreen } from './LoginScreen';
import { useHashRoute } from './router';
import { AppShell } from './shell/AppShell';

type BootState =
  | { status: 'loading' }
  | { status: 'down'; message: string }
  | { status: 'ready'; meta: MetaResponse; user: User | null; users: User[]; usersError: boolean };

async function loadMeta(): Promise<MetaResponse> {
  return api.get<MetaResponse>('/api/meta');
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function App(): JSX.Element {
  const [boot, setBoot] = useState<BootState>({ status: 'loading' });
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const route = useHashRoute();
  const contentRef = useRef<HTMLDivElement | null>(null);
  useBlockMotion(contentRef);
  // QR жюри ведёт на `/call`: публичная страница звонка без входа и без оболочки диспетчерской.
  const callPage = isCallPath(
    typeof window === 'undefined' ? '' : window.location.pathname,
    typeof window === 'undefined' ? '' : window.location.hash,
  );

  const bootLoad = useCallback(async (): Promise<void> => {
    setBoot({ status: 'loading' });
    try {
      const [meta, usersResponse, session] = await Promise.all([
        loadMeta(),
        api.get<UsersResponse>('/api/users').catch(() => null),
        api.get<SessionResponse>('/api/session').catch((error: unknown) => {
          if (error instanceof ApiError && error.status === 401) return null;
          throw error;
        }),
      ]);
      setBoot({
        status: 'ready',
        meta,
        user: session?.user ?? null,
        users: usersResponse?.users ?? [],
        usersError: usersResponse === null,
      });
    } catch (error) {
      setBoot({ status: 'down', message: errorText(error) });
    }
  }, []);

  useEffect(() => {
    if (callPage) return;
    void bootLoad();
  }, [bootLoad, callPage]);

  const logout = useCallback(async (): Promise<void> => {
    try {
      await api.post('/api/logout', {});
    } finally {
      setBoot((previous) => (previous.status === 'ready' ? { ...previous, user: null } : previous));
    }
  }, []);

  const login = useCallback(async (userId: string): Promise<void> => {
    setBusyUserId(userId);
    setLoginError(null);
    try {
      const session = await api.post<SessionResponse>('/api/session', { userId });
      setBoot((previous) => (previous.status === 'ready' ? { ...previous, user: session.user } : previous));
    } catch (error) {
      setLoginError(`Не удалось войти: ${errorText(error)}`);
    } finally {
      setBusyUserId(null);
    }
  }, []);

  if (callPage) {
    return (
      <div className="app app--call">
        <div className="app__content">
          <PhoneCallPage api={api} />
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="ugra-ambient" aria-hidden="true">
        <span className="ugra-ambient__blob ugra-ambient__blob--violet" />
        <span className="ugra-ambient__blob ugra-ambient__blob--blue" />
        <span className="ugra-ambient__blob ugra-ambient__blob--ice" />
      </div>

      {/* Вне шапки (заставка, ошибка API, вход) переключатель плавает в углу. */}
      {(boot.status !== 'ready' || boot.user === null) && <ThemeToggle floating />}

      <div className="app__content" ref={contentRef}>
        {boot.status === 'loading' && (
          <main className="splash">
            <span className="splash__mark" aria-hidden="true">
              Д
            </span>
            <p className="ugra-muted">Загружаем диспетчерскую…</p>
          </main>
        )}

        {boot.status === 'down' && (
          <main className="api-down">
            <section className="api-down__card ugra-card">
              <span className="api-down__dot" aria-hidden="true" />
              <h1>API не отвечает</h1>
              <p className="ugra-muted">
                Интерфейс загрузился, но сервер не ответил. Проверьте, что запущен <code>pnpm dev:api</code>.
              </p>
              <p className="api-down__details">{boot.message}</p>
              <button type="button" className="ugra-btn ugra-btn--primary" onClick={() => void bootLoad()}>
                Обновить
              </button>
            </section>
          </main>
        )}

        {boot.status === 'ready' && boot.user === null && (
          <LoginScreen
            users={boot.users}
            busyUserId={busyUserId}
            error={loginError}
            usersError={boot.usersError}
            onLogin={(userId) => void login(userId)}
            onRetry={() => void bootLoad()}
          />
        )}

        {boot.status === 'ready' && boot.user !== null && (
          <AppShell user={boot.user} meta={boot.meta} api={api} route={route} onLogout={() => void logout()} />
        )}
      </div>
    </div>
  );
}
