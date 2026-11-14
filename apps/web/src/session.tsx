import type { User } from '@ugra/contracts';
import type { JSX, ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from './api';

export interface SessionContextValue {
  user: User | null;
  loading: boolean;
  pending: boolean;
  error: string | null;
  signIn: (userId: string) => Promise<boolean>;
  signOut: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/** Состояние пользователя в контексте: вход выбором готового пользователя. */
export function SessionProvider({ children }: { children: ReactNode }): JSX.Element {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .session()
      .then((found) => {
        if (alive) setUser(found);
      })
      .catch((cause: unknown) => {
        if (!alive) return;
        setError(cause instanceof ApiError ? cause.message : 'Не удалось проверить сессию');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const signIn = useCallback(async (userId: string): Promise<boolean> => {
    setPending(true);
    setError(null);
    try {
      const nextUser = await api.signIn(userId);
      setUser(nextUser);
      return true;
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Не удалось войти');
      return false;
    } finally {
      setPending(false);
    }
  }, []);

  const signOut = useCallback((): void => {
    // Отдельного маршрута выхода нет: возвращаемся к экрану выбора пользователя.
    setUser(null);
    setError(null);
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({ user, loading, pending, error, signIn, signOut }),
    [user, loading, pending, error, signIn, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession вызван вне SessionProvider');
  return value;
}
