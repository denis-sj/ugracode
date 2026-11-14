import type { MetaResponse, User } from '@ugra/contracts';

/**
 * Контракт страницы веб-модуля. Типы контрактов импортируются только как типы —
 * в браузерный бандл из `@ugra/contracts` ничего не попадает.
 */
export interface ApiClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
}

export interface WebPageProps {
  user: User;
  meta: MetaResponse;
  api: ApiClient;
  navigate: (path: string) => void;
  /** Query из hash: `#/queue?status=in_review` → `query.get('status')`. */
  query: URLSearchParams;
  /** Счётчик действий для К4: клик, ввод, выбор, переход. */
  trackAction?: (kind: 'click' | 'input' | 'select' | 'navigate' | 'system') => void;
}

/** То, что нужно любому компоненту слота: описание виджета из веб-модуля. */
export interface SlotWidget {
  slot: string;
  id: string;
  order: number;
  roles: readonly string[];
  // Компонент приходит из веб-модуля как `unknown` — Slot сам проверяет, что это React-компонент.
  component: unknown;
}

export type BadgeTone =
  | 'neutral'
  | 'accent'
  | 'ok'
  | 'warn'
  | 'danger'
  | 'info'
  | 'emergency'
  | 'critical'
  | 'high'
  | 'medium'
  | 'low'
  | 'muted';
