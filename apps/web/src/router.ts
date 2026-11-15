import { useCallback, useEffect, useMemo, useState } from 'react';
import { trimEndChars } from '@ugra/contracts';

export interface Route {
  /** Путь без решётки и query: `/chat`. */
  path: string;
  query: URLSearchParams;
}

/** `#/tickets?tab=closed` → `{ path: '/tickets', query: tab=closed }`. */
export function parseHash(hash: string): Route {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const [rawPath = '', rawQuery = ''] = raw.split('?');
  return { path: normalizePath(rawPath), query: new URLSearchParams(rawQuery) };
}

/** Пустой или относительный путь → абсолютный вид `/chat` без хвоста. */
export function normalizePath(path: string): string {
  const trimmed = path.trim();
  const withoutTrailing = trimEndChars(trimmed, '/');
  if (withoutTrailing === '') return '/';
  return withoutTrailing.startsWith('/') ? withoutTrailing : `/${withoutTrailing}`;
}

export function toHash(path: string): string {
  return `#${normalizePath(path)}`;
}

export interface HashRoute extends Route {
  navigate: (path: string) => void;
}

/** Hash-роутинг без React Router: одна строка состояния на приложение. */
export function useHashRoute(): HashRoute {
  const [route, setRoute] = useState<Route>(() =>
    parseHash(typeof window === 'undefined' ? '' : window.location.hash),
  );

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onChange = (): void => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const navigate = useCallback((path: string): void => {
    if (typeof window === 'undefined') return;
    const next = toHash(path);
    if (window.location.hash === next) return;
    window.location.hash = next;
  }, []);

  return useMemo(() => ({ ...route, navigate }), [navigate, route]);
}
