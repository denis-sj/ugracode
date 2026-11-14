import { useEffect, useState } from 'react';
import type { OverviewResult } from '../contracts';
import { fetchOverview, type OverviewQuery } from './api';

export interface OverviewState {
  data: OverviewResult | null;
  loading: boolean;
  error: string | null;
}

/**
 * Загружает отчёт О0. `null` в качестве запроса отключает загрузку:
 * страница уже получила данные и передала их виджетам.
 */
export function useOverview(query: OverviewQuery | null): OverviewState {
  const [state, setState] = useState<OverviewState>({
    data: null,
    loading: query !== null,
    error: null,
  });
  const key = query ? JSON.stringify(query) : '';

  useEffect(() => {
    if (key === '') {
      setState({ data: null, loading: false, error: null });
      return undefined;
    }
    const parsed = JSON.parse(key) as OverviewQuery;
    let alive = true;
    setState((current) => ({ data: current.data, loading: true, error: null }));
    fetchOverview(parsed)
      .then((data) => {
        if (alive) setState({ data, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (alive) {
          setState({
            data: null,
            loading: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => {
      alive = false;
    };
  }, [key]);

  return state;
}
