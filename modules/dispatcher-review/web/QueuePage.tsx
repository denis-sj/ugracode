import type { Ticket, TicketListResponse, TicketResponse, TicketStatus } from '@ugra/contracts';
import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, formatDateTime } from '@ugra/ui';
import type { WebPageProps } from '@ugra/ui';
import {
  DEFAULT_FILTERS,
  extractLocation,
  filterTickets,
  PRIORITY_LABELS,
  priorityTone,
  STATUS_LABELS,
  statusTone,
} from './format';
import type { TicketFilters } from './format';
import { TicketCard } from './TicketCard';

const STATUS_FILTERS: ReadonlyArray<{ value: TicketStatus | 'all'; label: string }> = [
  { value: 'all', label: 'Все' },
  { value: 'in_review', label: 'На проверке' },
  { value: 'waiting_applicant', label: 'Ждут ответа' },
  { value: 'assigned', label: 'Назначенные' },
  { value: 'in_progress', label: 'В работе' },
  { value: 'resolved', label: 'Решённые' },
  { value: 'closed', label: 'Закрытые' },
];

interface LocationEntry {
  building: string | null;
  cabinet: string | null;
}

function categoryLabel(meta: WebPageProps['meta'], code: string | null): string {
  if (!code) return '—';
  const item = meta.dictionaries.find((entry) => entry.dictionary === 'category' && entry.code === code);
  return item?.label ?? code;
}

/** Очередь заявок: фильтры, таблица и карточка выбранной заявки. */
export function QueuePage({ user, meta, api, trackAction }: WebPageProps): JSX.Element {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<TicketFilters>(DEFAULT_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [locations, setLocations] = useState<Record<string, LocationEntry>>({});
  const [refreshToken, setRefreshToken] = useState(0);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<TicketListResponse>('/api/tickets?limit=100');
      setTickets(response.tickets);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось загрузить очередь');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

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
  }, [tickets, api]);

  const visible = useMemo(() => filterTickets(tickets, filters), [tickets, filters]);
  const emergencyCount = useMemo(() => tickets.filter((ticket) => ticket.isEmergency).length, [tickets]);

  const reset = (): void => setFilters(DEFAULT_FILTERS);

  return (
    <div className="page queue">
      <header className="page__head">
        <div>
          <h1 className="page__title">Очередь заявок</h1>
          <p className="page__lead">
            ИИ заполнил поля — проверьте сомнительные, посмотрите цитаты и журнал, назначьте исполнителя.
          </p>
        </div>
        <div className="page__actions">
          <Badge tone="accent">{visible.length} в выборке</Badge>
          <Badge tone={emergencyCount > 0 ? 'danger' : 'neutral'} dot={emergencyCount > 0}>
            Аварийных: {emergencyCount}
          </Badge>
          <Button variant="secondary" size="sm" onClick={() => setRefreshToken((value) => value + 1)} loading={loading}>
            Обновить
          </Button>
        </div>
      </header>

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
          onChange={(event) => setFilters((previous) => ({ ...previous, query: event.target.value }))}
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

      {error && (
        <Card tone="danger">
          <h2>API не отвечает</h2>
          <p className="ugra-muted">{error}</p>
          <Button variant="secondary" size="sm" onClick={() => void load()}>
            Обновить
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
                  <th>Статус</th>
                  <th>Приоритет</th>
                  <th>Категория</th>
                  <th>Место</th>
                  <th>Время</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((ticket) => {
                  const location = locations[ticket.id];
                  const place = location
                    ? `${location.building ?? '—'} · каб. ${location.cabinet ?? '—'}`
                    : 'загружаем…';
                  return (
                    <tr
                      key={ticket.id}
                      className={`queue-row${ticket.id === selectedId ? ' queue-row--selected' : ''}${
                        ticket.isEmergency ? ' queue-row--emergency' : ''
                      }`}
                      tabIndex={0}
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
                        <Badge tone={statusTone(ticket.status)}>{STATUS_LABELS[ticket.status]}</Badge>
                      </td>
                      <td>
                        <Badge tone={priorityTone(ticket.priority)} dot={ticket.isEmergency}>
                          {PRIORITY_LABELS[ticket.priority ?? 'medium']}
                        </Badge>
                      </td>
                      <td>{categoryLabel(meta, ticket.category)}</td>
                      <td className="queue-loc">{place}</td>
                      <td className="queue-sla">{formatDateTime(ticket.createdAt)}</td>
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
            trackAction={trackAction}
            onClose={() => setSelectedId(null)}
            onChanged={() => setRefreshToken((value) => value + 1)}
          />
        )}
      </div>
    </div>
  );
}
