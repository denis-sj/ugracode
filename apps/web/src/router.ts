import { useCallback, useEffect, useState } from 'react';

/** Нормализует hash в путь: `#/chat/` → `/chat`, пустой → `/`. */
export function normalizePath(hash: string): string {
  const raw = hash.replace(/^#/, '').trim();
  if (!raw) return '/';
  const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
  const withoutTrailing = withSlash.replace(/\/+$/, '');
  return withoutTrailing || '/';
}

export interface HashRoute {
  path: string;
  navigate: (next: string) => void;
}

/** Роутинг без React Router: hash + подписка на `hashchange`. */
export function useHashRoute(): HashRoute {
  const [path, setPath] = useState<string>(() =>
    typeof window === 'undefined' ? '/' : normalizePath(window.location.hash),
  );

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onChange = (): void => setPath(normalizePath(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const navigate = useCallback((next: string): void => {
    if (typeof window === 'undefined') return;
    const target = normalizePath(next);
    if (normalizePath(window.location.hash) === target) {
      setPath(target);
      return;
    }
    window.location.hash = `#${target}`;
    setPath(target);
  }, []);

  return { path, navigate };
}
