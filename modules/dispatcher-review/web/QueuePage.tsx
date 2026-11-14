import './review.css';
import type { Ticket, TicketListResponse, TicketResponse, TicketStatus } from '@ugra/contracts';
import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Card, StatTile } from '@ugra/ui';
import type { WebPageProps } from '@ugra/ui';
import {
  DEFAULT_FILTERS,
  extractLocation,
  filterTickets,
  overdueCount,
  sortTickets,
  STATUS_LABELS,
  statusTone,
} from './format';
import type { TicketFilters } from './format';
import { DeadlineChips, PriorityBars } from './parts';
import { TicketCard } from './TicketCard';
import { useNow } from './useNow';

const STATUS_FILTERS: ReadonlyArray<{ value: TicketStatus | 'all'; label: string }> = [
  { value: 'all', label: 'Все' },
  { value: 'in_review', label: 'На проверке' },
  { value: 'waiting_applicant', label: 'Ждут ответа' },
  { value: 'assigned', label: 'Назначенные' },
  { value: 'in_progress', label: 'В работе' },
  { value: 'resolved', label: 'Решённые' },
  { value: 'closed', label: 'Закрытые' },
];

/** Живое обновление очереди: сервер пока не отдаёт общий поток событий, поэтому опрос. */
const LIVE_REFRESH_MS = 15_000;
/** Сколько держится подсветка изменившейся строки. */
const FRESH_HIGHLIGHT_MS = 12_000;

interface LocationEntry {
  building: string | null;
  cabinet: string | null;
}

function categoryLabel(meta: WebPageProps['meta'], code: string | null): string {
  if (!code) return '—';
  const item = meta.dictionaries.find((entry) => entry.dictionary === 'category' && entry.code === code);
  return item?.label ?? code;
}

/** Очередь заявок: сводка, фильтры, сортировка по приоритету и сроку, карточка выбранной заявки. */
export function QueuePage({ user, meta, api, trackAction }: WebPageProps): JSX.Element {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<TicketFilters>(DEFAULT_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [locations, setLocations] = useState<Record<string, LocationEntry>>({});
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [refreshToken, setRefreshToken] = useState(0);
  const [liveAt, setLiveAt] = useState<number | null>(null);

  const now = useNow(30_000);
  const updatedAtRef = useRef<Map<string, string>>(new Map());
  const freshTimerRef = useRef<number | null>(null);

  const markFresh = useCallback((ids: readonly string[]): void => {
    if (ids.length === 0) return;
    setFresh(new Set(ids));
    if (freshTimerRef.current !== null) window.clearTimeout(freshTimerRef.current);
    freshTimerRef.current = window.setTimeout(() => setFresh(new Set<string>()), FRESH_HIGHLIGHT_MS);
  }, []);

  const load = useCallback(
    async (mode: 'loud' | 'quiet' = 'loud'): Promise<void> => {
      if (mode === 'loud') {
        setLoading(true);
        setError(null);
      }
      try {
        const response = await api.get<TicketListResponse>('/api/tickets?limit=100');
        const previous = updatedAtRef.current;
        // новые и изменившиеся строки: новая заявка «въезжает» сверху со вспышкой
        const changed = response.tickets
          .filter((ticket) => previous.get(ticket.id) !== ticket.updatedAt)
          .map((ticket) => ticket.id);
        updatedAtRef.current = new Map(response.tickets.map((ticket) => [ticket.id, ticket.updatedAt] as const));
        setTickets(response.tickets);
        setLiveAt(Date.now());
        setError(null);
        if (mode === 'quiet') markFresh(changed);
      } catch (cause) {
        if (mode === 'loud') setError(cause instanceof Error ? cause.message : 'Не удалось загрузить очередь');
      } finally {
        if (mode === 'loud') setLoading(false);
      }
    },
    [api, markFresh],
  );

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void load('quiet');
    }, LIVE_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(
    () => () => {
      if (freshTimerRef.current !== null) window.clearTimeout(freshTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    let alive = true;
    const missing = tickets.filter((ticket) => !(ticket.id in locations)).slice(0, 24);
    if (missing.length === 0) return undefined;

    void Promise.all(
      missing.map(async (ticket) => {
        try {
          const detail = await api.get<TicketResponse>(`/api/tickets/${ticket.id}`);
          return [ticket.id, extractLocation(detail.fields)] as const;
        } catch {
          return [ticket.id, { building: null, cabinet: null }] as const;
        }
      }),
    ).then((entries) => {
      if (!alive) return;
      setLocations((previous) => {
        const next: Record<string, LocationEntry> = { ...previous };
        for (const [id, location] of entries) next[id] = location;
        return next;
      });
    });

    return () => {
      alive = false;
    };
  }, [tickets, api, locations]);

  const visible = useMemo(() => sortTickets(filterTickets(tickets, filters)), [tickets, filters]);
  const summary = useMemo(
    () => ({
      review: tickets.filter((ticket) => ticket.status === 'in_review').length,
      waiting: tickets.filter((ticket) => ticket.status === 'waiting_applicant').length,
      active: tickets.filter((ticket) => ticket.status === 'assigned' || ticket.status === 'in_progress').length,
      emergency: tickets.filter((ticket) => ticket.isEmergency).length,
      overdue: overdueCount(tickets, now),
    }),
    [tickets, now],
  );

  const reset = (): void => setFilters(DEFAULT_FILTERS);

  return (
    <div className="page queue">
      <header className="page__head">
        <div>
          <h1 className="page__title">Очередь заявок</h1>
          <p className="page__lead">
            Сверху аварии и просроченные. Проверьте спорные поля, поправьте одно действие и подтвердите —
            Enter подтверждает и назначает.
          </p>
        </div>
        <div className="page__actions">
          <Badge tone="accent">{visible.length} в выборке</Badge>
          <Badge tone={summary.overdue > 0 ? 'danger' : 'neutral'} dot={summary.overdue > 0}>
            Просрочено: {summary.overdue}
          </Badge>
          <Button variant="secondary" size="sm" onClick={() => setRefreshToken((value) => value + 1)} loading={loading}>
            Обновить
          </Button>
        </div>
      </header>

      <div className="dr-stats">
        <StatTile label="Ждут проверки" value={summary.review} tone="warn" />
        <StatTile label="Ждут заявителя" value={summary.waiting} tone="accent" />
        <StatTile label="В работе" value={summary.active} tone="ok" />
        <StatTile label="Аварийных" value={summary.emergency} tone="danger" />
      </div>

      <Card className="queue__toolbar" padded={false}>
        <div className="queue__filters" role="group" aria-label="Фильтр по статусу">
          {STATUS_FILTERS.map((filter) => (
            <button
              type="button"
              key={filter.value}
              className={`queue-filter${filters.status === filter.value ? ' queue-filter--active' : ''}`}
              onClick={() => {
                setFilters((previous) => ({ ...previous, status: filter.value }));
                trackAction?.('select');
              }}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <span className="ugra-spacer" />
        <input
          className="queue__search"
          value={filters.query}
          placeholder="Поиск по номеру или категории"
          onChange={(event) => {
            setFilters((previous) => ({ ...previous, query: event.target.value }));
            trackAction?.('input');
          }}
          aria-label="Поиск заявок"
        />
        <button
          type="button"
          className={`queue__toggle${filters.onlyEmergency ? ' queue__toggle--active' : ''}`}
          onClick={() => {
            setFilters((previous) => ({ ...previous, onlyEmergency: !previous.onlyEmergency }));
            trackAction?.('select');
          }}
          aria-pressed={filters.onlyEmergency}
        >
          ⚠ Только аварии
        </button>
      </Card>

      <p className="dr-hint">
        {liveAt ? 'Очередь обновляется сама каждые 15 секунд' : 'Обновляем очередь'} · <b>Enter</b> открывает заявку,{' '}
        <b>Tab</b> — только спорные поля
      </p>

      {error && (
        <Card tone="danger">
          <h2>API не отвечает</h2>
          <p className="ugra-muted">{error}</p>
          <Button variant="secondary" size="sm" onClick={() => void load()}>
            Повторить
          </Button>
        </Card>
      )}

      <div className={`queue__layout${selectedId ? ' queue__layout--detail' : ''}`}>
        <Card className="queue__list" padded={false}>
          {loading && (
            <div className="ticket__skeleton" aria-label="Загружаем очередь">
              <div className="ticket__skeleton-line" style={{ width: '88%' }} />
              <div className="ticket__skeleton-line" style={{ width: '72%' }} />
              <div className="ticket__skeleton-line" style={{ width: '80%' }} />
              <div className="ticket__skeleton-line" style={{ width: '64%' }} />
            </div>
          )}

          {!loading && !error && visible.length === 0 && (
            <div className="queue-empty">
              <span className="queue-empty__mark" aria-hidden="true">
                ⌕
              </span>
              <p>Под фильтры ничего не подошло.</p>
              <Button variant="secondary" size="sm" onClick={reset}>
                Сбросить фильтры
              </Button>
            </div>
          )}

          {!loading && visible.length > 0 && (
            <table className="queue-table">
              <thead>
                <tr>
                  <th>№</th>
                  <th>Приоритет</th>
                  <th>Статус</th>
                  <th>Категория</th>
                  <th>Место</th>
                  <th>Срок по регламенту</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((ticket) => {
                  const location = locations[ticket.id];
                  const place = location
                    ? `${location.building ?? '—'} · каб. ${location.cabinet ?? '—'}`
                    : 'загружаем…';
                  const isFresh = fresh.has(ticket.id);
                  return (
                    <tr
                      key={ticket.id}
                      className={`queue-row${ticket.id === selectedId ? ' queue-row--selected' : ''}${
                        ticket.isEmergency ? ' queue-row--emergency' : ''
                      }${isFresh ? ' dr-row--fresh' : ''}`}
                      tabIndex={0}
                      aria-current={ticket.id === selectedId ? 'true' : undefined}
                      onClick={() => {
                        setSelectedId(ticket.id);
                        trackAction?.('select');
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setSelectedId(ticket.id);
                          trackAction?.('select');
                        }
                      }}
                    >
                      <td className="queue-num">{ticket.number}</td>
                      <td>
                        <PriorityBars priority={ticket.priority} isEmergency={ticket.isEmergency} />
                      </td>
                      <td>
                        <Badge tone={statusTone(ticket.status)}>{STATUS_LABELS[ticket.status]}</Badge>
                      </td>
                      <td>{categoryLabel(meta, ticket.category)}</td>
                      <td className="queue-loc">{place}</td>
                      <td>
                        <DeadlineChips ticket={ticket} now={now} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>

        {selectedId && (
          <TicketCard
            api={api}
            meta={meta}
            user={user}
            ticketId={selectedId}
            onClose={() => setSelectedId(null)}
            onChanged={(ticketId) => {
              markFresh(ticketId ? [ticketId] : []);
              void load('quiet');
            }}
            trackAction={trackAction}
          />
        )}
      </div>
    </div>
  );
}
