import { useCallback, useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import type { MetaResponse, Ticket, TicketListResponse } from '@ugra/contracts';
import { formatDayMonth, formatTicketStatus, groupHistory, ticketStatusTone } from '@ugra/ui';
import type { ApiClient } from '@ugra/ui';
import { matchesQuery } from './lib';

export interface HistoryDrawerProps {
  open: boolean;
  api: ApiClient;
  meta: MetaResponse;
  onClose: () => void;
  navigate: (path: string) => void;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function statusClass(ticket: Ticket): string {
  return `history-item__status history-item__status--${ticketStatusTone(ticket.status)}`;
}

/** История обращений заявителя: выезжающая панель справа (3.3). */
export function HistoryDrawer({
  open,
  api,
  meta,
  onClose,
  navigate,
}: HistoryDrawerProps): JSX.Element | null {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<TicketListResponse>('/api/tickets?limit=50');
      setTickets(response.tickets);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    void load();
  }, [load, open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, open]);

  const groups = useMemo(() => groupHistory(tickets), [tickets]);
  const categoryLabel = (ticket: Ticket): string => {
    if (!ticket.category) return 'Обращение';
    const found = meta.dictionaries.find(
      (item) => item.dictionary === 'category' && item.code === ticket.category,
    );
    return found?.label ?? ticket.category;
  };
  const filter = (ticket: Ticket): boolean =>
    matchesQuery(query, ticket.number, categoryLabel(ticket), formatTicketStatus(ticket.status));
  const active = groups.active.filter(filter);
  const closed = groups.closed.filter(filter);

  if (!open) return null;

  const renderItem = (ticket: Ticket): JSX.Element => (
    <button
      type="button"
      className="history-item"
      key={ticket.id}
      onClick={() => {
        navigate('/tickets');
        onClose();
      }}
    >
      <span className="history-item__top">
        <span className="history-item__title">{categoryLabel(ticket)}</span>
        <span className="history-item__date">{formatDayMonth(ticket.createdAt)}</span>
      </span>
      <span className="history-item__meta">
        № {ticket.number} · <span className={statusClass(ticket)}>{formatTicketStatus(ticket.status)}</span>
      </span>
    </button>
  );

  return (
    <>
      <button type="button" className="history-backdrop" aria-label="Закрыть историю" onClick={onClose} />
      <aside className="history-drawer" role="dialog" aria-label="История обращений">
        <div className="history-drawer__head">
          <h2 className="history-drawer__title">История обращений</h2>
          <button type="button" className="history-drawer__close" aria-label="Закрыть" onClick={onClose}>
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="history-drawer__search">
          <label className="chat-visually-hidden" htmlFor="history-search">
            Поиск по истории
          </label>
          <input
            id="history-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск по номеру или статусу"
          />
        </div>

        <div className="history-drawer__body">
          {loading && tickets.length === 0 && <p className="history-drawer__hint">Загружаем…</p>}
          {error && (
            <div className="history-drawer__error">
              <p>{error}</p>
              <button
                type="button"
                className="ugra-btn ugra-btn--secondary ugra-btn--sm"
                onClick={() => void load()}
              >
                Повторить
              </button>
            </div>
          )}

          {!loading && !error && active.length === 0 && closed.length === 0 && (
            <p className="history-drawer__hint">
              {query === '' ? 'Обращений пока нет' : 'Ничего не найдено'}
            </p>
          )}

          {active.length > 0 && (
            <>
              <div className="history-drawer__group">Активные</div>
              {active.map(renderItem)}
            </>
          )}
          {closed.length > 0 && (
            <>
              <div className="history-drawer__group">Ранее</div>
              {closed.map(renderItem)}
            </>
          )}
        </div>
      </aside>
    </>
  );
}
