import type { TicketResponse } from '@ugra/contracts';
import { useCallback, useEffect, useState } from 'react';
import type { WebPageProps } from '@ugra/ui';
import { knowledgeQueries } from './format';
import type { KnowledgeResponse } from './format';
import type { Loadable } from './types';

const EMPTY_LOAD: Loadable<never> = { loading: false, error: null, data: null };
/** Сколько вариантов запроса пробуем в базе знаний: точный, затем всё более общий. */
const QUERY_TRIES = 4;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface DiagnosticsResult {
  state: Loadable<KnowledgeResponse>;
  /** Запрос, который дал лучший ответ: по нему подбирается статья. */
  query: string;
  retry: () => void;
}

/**
 * Поиск статьи и похожих заявок под текущую задачу.
 *
 * Сервер ищет по всем словам сразу, поэтому один редкий симптом обнуляет выдачу:
 * варианты запроса идут от точного к общему, а показываем тот ответ, где больше данных.
 */
export function useDiagnostics(api: WebPageProps['api'], detail: TicketResponse | null): DiagnosticsResult {
  const [state, setState] = useState<Loadable<KnowledgeResponse>>(EMPTY_LOAD);
  const [query, setQuery] = useState('');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!detail) {
      setState(EMPTY_LOAD);
      setQuery('');
      return undefined;
    }
    const queries = knowledgeQueries(detail.fields, detail.ticket.category);
    if (queries.length === 0) {
      setState(EMPTY_LOAD);
      setQuery('');
      return undefined;
    }

    let alive = true;
    setState({ loading: true, error: null, data: null });
    setQuery('');

    void (async () => {
      let best: { response: KnowledgeResponse; query: string; score: number } | null = null;
      let failure: string | null = null;
      for (const candidate of queries.slice(0, QUERY_TRIES)) {
        try {
          const response = await api.get<KnowledgeResponse>(
            `/api/m/knowledge/search?q=${encodeURIComponent(candidate)}`,
          );
          if (!alive) return;
          const score = response.articles.length * 100 + response.tickets.length;
          if (best === null || score > best.score) {
            best = { response, query: candidate, score };
          }
          // Статья и похожие заявки сразу — дальше уточнять нечего.
          if (response.articles.length > 0 && response.tickets.length > 0) break;
        } catch (cause: unknown) {
          failure = errorText(cause);
        }
      }
      if (!alive) return;
      if (best === null) {
        setState({ loading: false, error: failure ?? 'База знаний не ответила', data: null });
        return;
      }
      setQuery(best.query);
      setState({ loading: false, error: null, data: best.response });
    })();

    return () => {
      alive = false;
    };
  }, [api, detail, tick]);

  const retry = useCallback(() => setTick((value) => value + 1), []);

  return { state, query, retry };
}
