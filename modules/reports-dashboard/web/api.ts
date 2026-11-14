import type { OverdueResult, OverviewResult } from '../contracts';
import { isValidRange, rangeEnd, rangeStart } from './format';

/** Клиент отчёта О0: только чтение маршрута модуля, cookie-сессия. */

export interface OverviewFiltersState {
  category?: string;
  assigneeId?: string;
  channel?: string;
  building?: string;
  status?: string;
}

export interface OverviewQuery extends OverviewFiltersState {
  days?: number;
  from?: string;
  to?: string;
}

/** Запрос страницы: выбранные даты важнее пресета, конец диапазона включает весь день. */
export function overviewQuery(
  days: number,
  from: string,
  to: string,
  filters: OverviewFiltersState,
): OverviewQuery {
  if (isValidRange(from, to)) {
    return { ...filters, from: rangeStart(from), to: rangeEnd(to) };
  }
  return { ...filters, days };
}

function queryString(query: OverviewQuery): string {
  const params = new URLSearchParams();
  if (query.from && query.to) {
    params.set('from', query.from);
    params.set('to', query.to);
  } else if (query.days) {
    params.set('days', String(query.days));
  }
  for (const key of ['category', 'assigneeId', 'channel', 'building', 'status'] as const) {
    const value = query[key];
    if (value) params.set(key, value);
  }
  return params.toString();
}

export async function fetchOverdue(query: OverviewQuery, signal?: AbortSignal): Promise<OverdueResult> {
  const suffix = queryString(query);
  const response = await fetch(
    `/api/m/reports-dashboard/overdue${suffix ? `?${suffix}` : ''}`,
    { credentials: 'include', headers: { accept: 'application/json' }, signal },
  );
  if (!response.ok) {
    throw new Error(`Список просрочек недоступен: HTTP ${response.status}`);
  }
  return (await response.json()) as OverdueResult;
}

export async function fetchOverview(query: OverviewQuery): Promise<OverviewResult> {
  const suffix = queryString(query);
  const response = await fetch(
    `/api/m/reports-dashboard/overview${suffix ? `?${suffix}` : ''}`,
    { credentials: 'include', headers: { accept: 'application/json' } },
  );
  if (!response.ok) {
    throw new Error(`Отчёт недоступен: HTTP ${response.status}`);
  }
  return (await response.json()) as OverviewResult;
}
