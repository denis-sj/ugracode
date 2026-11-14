import './review.css';
import type { Ticket, TicketListResponse, TicketResponse, User, UsersResponse } from '@ugra/contracts';
import { hasPermission } from '@ugra/contracts';
import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Card, EmptyState, PriorityMark, SearchField, Segmented } from '@ugra/ui';
import type { WebPageProps } from '@ugra/ui';
import {
  DEFAULT_FILTERS,
  locationFromTicket,
  filterTickets,
  formatLocation,
  promoteNew,
  queueAction,
  queueEventAction,
  queueFiltersFromQuery,
  queueSummary,
  sortTickets,
  STATUS_LABELS,
  ticketSignals,
  ticketTitleFromFields,
  waitingLabel,
} from './format';
import type { QueueBucket, QueueSignals, TicketFilters } from './format';
import { QueuePreview } from './QueuePreview';
import { useNow } from './useNow';

/** Сколько строк догружаем деталями для уверенности и места (кэш до перезагрузки). */
const DETAIL_LIMIT = 24;
/** Страховочный опрос, если SSE недоступен. */
const POLL_MS = 15_000;
/** Подсветка новых и изменившихся строк. */
const FRESH_MS = 12_000;

interface QueueDetail {
  detail: TicketResponse | null;
  signals: QueueSignals;
  location: string;
  title: string;
}

function categoryLabel(meta: WebPageProps['meta'], code: string | null): string {
  if (!code) return '—';
  return meta.dictionaries.find((entry) => entry.dictionary === 'category' && entry.code === code)?.label ?? code;
}

function buildingLabel(meta: WebPageProps['meta'], code: string): string {
  return meta.dictionaries.find((entry) => entry.dictionary === 'building' && entry.code === code)?.label ?? code;
}

function ConfidenceCell({ signals }: { signals?: QueueSignals }): JSX.Element {
  const value = signals?.confidence ?? null;
  if (value === null) return <span className="queue-conf queue-conf--empty">—</span>;
  const percent = Math.round(value * 100);
  return (
    <span className={value < 0.75 ? 'queue-conf queue-conf--warn' : 'queue-conf'}>
      <span className="queue-conf__track" aria-hidden="true">
        <span className="queue-conf__fill" style={{ width: `${percent}%` }} />
      </span>
      <span className="queue-conf__value">{percent}%</span>
    </span>
  );
}

const BUCKETS: ReadonlyArray<{ value: QueueBucket; label: string }> = [
  { value: 'all', label: 'Все' },
  { value: 'suspicious', label: 'Сомнительные' },
  { value: 'ready', label: 'Готовые' },
  { value: 'emergency', label: 'Аварии' },
];

/** Очередь диспетчера (4.3): сводка, фильтры, таблица и превью выбранной заявки. */
export function QueuePage({ user, meta, api, navigate, query, trackAction }: WebPageProps): JSX.Element {
  const queryKey = query.toString();
  const initialFilters = useMemo(() => queueFiltersFromQuery(new URLSearchParams(queryKey)), [queryKey]);
  const [filters, setFilters] = useState<TicketFilters>(initialFilters);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [details, setDetails] = useState<Record<string, QueueDetail>>({});
  const [users, setUsers] = useState<User[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [newIds, setNewIds] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [liveMode, setLiveMode] = useState<'sse' | 'polling'>('sse');

  const now = useNow(30_000);
  const knownIdsRef = useRef<Set<string>>(new Set());
  const updatedAtRef = useRef<Map<string, string>>(new Map());
  const loadedDetailsRef = useRef<Set<string>>(new Set());
  const detailsInFlightRef = useRef<Set<string>>(new Set());
  const freshTimerRef = useRef<number | null>(null);
  const reloadTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setFilters(initialFilters);
  }, [initialFilters]);

  useEffect(() => {
    let alive = true;
    api
      .get<UsersResponse>('/api/users')
      .then((response) => {
        if (alive) setUsers(response.users);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [api]);

  const markFresh = useCallback((ids: readonly string[], added: readonly string[] = []): void => {
    setFresh(new Set(ids));
    setNewIds(new Set(added));
    if (freshTimerRef.current !== null) window.clearTimeout(freshTimerRef.current);
    freshTimerRef.current = window.setTimeout(() => {
      setFresh(new Set<string>());
      setNewIds(new Set<string>());
    }, FRESH_MS);
  }, []);

  const load = useCallback(
    async (mode: 'loud' | 'quiet' = 'loud'): Promise<void> => {
      if (mode === 'loud') {
        setLoading(true);
        setError(null);
      }
      try {
        const response = await api.get<TicketListResponse>('/api/tickets?limit=200');
        const previousUpdated = updatedAtRef.current;
        const previousIds = knownIdsRef.current;
        const changed = response.tickets
          .filter((ticket) => previousUpdated.has(ticket.id) && previousUpdated.get(ticket.id) !== ticket.updatedAt)
          .map((ticket) => ticket.id);
        const added = response.tickets.filter((ticket) => !previousIds.has(ticket.id)).map((ticket) => ticket.id);
        updatedAtRef.current = new Map(response.tickets.map((ticket) => [ticket.id, ticket.updatedAt] as const));
        knownIdsRef.current = new Set(response.tickets.map((ticket) => ticket.id));
        setTickets(response.tickets);
        setError(null);
        if (mode === 'quiet') markFresh(changed, added);
        setSelectedId((current) => (current && !response.tickets.some((ticket) => ticket.id === current) ? null : current));
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
  }, [load]);

  useEffect(() => {
    const candidates = filterTickets(tickets, {
      ...DEFAULT_FILTERS,
      status: filters.status,
      onlyEmergency: filters.onlyEmergency,
      assignee: filters.assignee,
    });
    const missing = sortTickets(candidates)
      .filter(
        (ticket) =>
          !loadedDetailsRef.current.has(ticket.id) && !detailsInFlightRef.current.has(ticket.id),
      )
      .slice(0, DETAIL_LIMIT);
    if (missing.length === 0) return;
    for (const ticket of missing) {
      loadedDetailsRef.current.add(ticket.id);
      detailsInFlightRef.current.add(ticket.id);
    }

    void Promise.all(
      missing.map(async (ticket) => {
        try {
          const detail = await api.get<TicketResponse>(`/api/tickets/${ticket.id}`);
          return [
            ticket.id,
            {
              detail,
              signals: ticketSignals(detail.fields),
              location: formatLocation(locationFromTicket(detail.ticket, detail.fields), (code) => buildingLabel(meta, code)),
              title: ticketTitleFromFields(detail.fields, (key, value) => {
                if (key === 'category') return categoryLabel(meta, value);
                return value;
              }),
            },
          ] as const;
        } catch {
          return [
            ticket.id,
            {
              detail: null,
              signals: { review: 0, confidence: null },
              location: 'место уточняется',
              title: categoryLabel(meta, ticket.category),
            },
          ] as const;
        } finally {
          detailsInFlightRef.current.delete(ticket.id);
        }
      }),
    ).then((entries) => {
      setDetails((previous) => {
        const next = { ...previous };
        for (const [id, entry] of entries) next[id] = entry;
        return next;
      });
    });
  }, [tickets, api, meta, filters.status, filters.onlyEmergency, filters.assignee]);

  const scheduleReload = useCallback((): void => {
    if (reloadTimerRef.current !== null) window.clearTimeout(reloadTimerRef.current);
    reloadTimerRef.current = window.setTimeout(() => {
      reloadTimerRef.current = null;
      void load('quiet');
    }, 400);
  }, [load]);

  useEffect(() => {
    if (typeof EventSource === 'undefined') {
      setLiveMode('polling');
      return undefined;
    }
    const source = new EventSource('/api/events/stream');
    source.onopen = () => setLiveMode('sse');
    source.onmessage = (message: MessageEvent<string>) => {
      let event: unknown;
      try {
        event = JSON.parse(message.data);
      } catch {
        return;
      }
      if (queueEventAction(event, knownIdsRef.current) !== 'ignored') scheduleReload();
    };
    source.onerror = () => {
      source.close();
      setLiveMode('polling');
    };
    return () => source.close();
  }, [scheduleReload]);

  useEffect(() => {
    if (liveMode !== 'polling') return undefined;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      void load('quiet');
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [liveMode, load]);

  useEffect(
    () => () => {
      if (freshTimerRef.current !== null) window.clearTimeout(freshTimerRef.current);
      if (reloadTimerRef.current !== null) window.clearTimeout(reloadTimerRef.current);
    },
    [],
  );

  const signals = useMemo(() => {
    const map: Record<string, QueueSignals> = {};
    for (const [id, detail] of Object.entries(details)) map[id] = detail.signals;
    return map;
  }, [details]);
  const locations = useMemo(() => {
    const map: Record<string, string> = {};
    for (const [id, detail] of Object.entries(details)) map[id] = detail.location;
    return map;
  }, [details]);

  const visible = useMemo(() => {
    const sorted = sortTickets(filterTickets(tickets, filters, { signals, locations }));
    return promoteNew(sorted, newIds);
  }, [tickets, filters, signals, locations, newIds]);

  const summary = useMemo(() => queueSummary(tickets, now), [tickets, now]);
  const bucketCounts = useMemo(() => {
    const base = {
      ...DEFAULT_FILTERS,
      status: filters.status,
      onlyEmergency: filters.onlyEmergency,
      assignee: filters.assignee,
    };
    const context = { signals, locations };
    return {
      all: filterTickets(tickets, base, context).length,
      suspicious: filterTickets(tickets, { ...base, bucket: 'suspicious' }, context).length,
      ready: filterTickets(tickets, { ...base, bucket: 'ready' }, context).length,
      emergency: filterTickets(tickets, { ...base, bucket: 'emergency' }, context).length,
    };
  }, [tickets, signals, locations, filters.status, filters.onlyEmergency, filters.assignee]);

  const selected = selectedId ? tickets.find((ticket) => ticket.id === selectedId) ?? null : null;

  return (
    <div className="queue-page">
      <header className="queue-head">
        <div>
          <h1 className="ugra-page-title">Очередь</h1>
          <p className="queue-lead">
            ИИ разобрал обращения. Подтвердите готовые и поправьте сомнительные.
          </p>
        </div>
        <div className="queue-summary" aria-label="Сводка очереди">
          <div>
            <span className="queue-summary__label">Ждут проверки</span>
            <b className="queue-summary__value">{summary.review}</b>
          </div>
          <div>
            <span className="queue-summary__label">Ждут заявителя</span>
            <b className="queue-summary__value">{summary.waiting}</b>
          </div>
          <div>
            <span className="queue-summary__label">Аварии</span>
            <b className="queue-summary__value queue-summary__value--danger">{summary.emergency}</b>
          </div>
          <div>
            <span className="queue-summary__label">За смену</span>
            <b className="queue-summary__value">{summary.perShift}</b>
          </div>
        </div>
      </header>

      <Card className="queue-toolbar" padded={false}>
        <div className="queue-toolbar__inner">
          <Segmented
            value={filters.bucket}
            label="Фильтр очереди"
            onChange={(bucket) => {
              setFilters((previous) => ({ ...previous, bucket }));
              trackAction?.('select');
            }}
            options={BUCKETS.map((bucket) => ({
              ...bucket,
              count: bucketCounts[bucket.value],
            }))}
          />
          <div className="queue-toolbar__right">
            <SearchField
              value={filters.query}
              label="Поиск заявок"
              placeholder="Номер, кабинет, текст"
              onChange={(value) => {
                setFilters((previous) => ({ ...previous, query: value }));
                trackAction?.('input');
              }}
            />
            <Button
              variant="secondary"
              size="sm"
              loading={loading}
              onClick={() => {
                void load();
              }}
            >
              Обновить
            </Button>
          </div>
        </div>

        {(filters.status !== 'all' || filters.onlyEmergency || filters.assignee !== '') && (
          <div className="queue-active-filters">
            {filters.status !== 'all' && <Badge tone="info">Статус: {STATUS_LABELS[filters.status]}</Badge>}
            {filters.onlyEmergency && <Badge tone="danger">Только аварии</Badge>}
            {filters.assignee !== '' && (
              <Badge tone="accent">
                Исполнитель: {users.find((candidate) => candidate.id === filters.assignee)?.fullName ?? filters.assignee}
              </Badge>
            )}
            <button
              type="button"
              className="queue-reset"
              onClick={() => setFilters(DEFAULT_FILTERS)}
            >
              Сбросить
            </button>
          </div>
        )}
      </Card>

      <p className="queue-hint">
        {liveMode === 'sse' ? 'Живые обновления включены' : 'Обновляем опросом раз в 15 секунд'}
        {' · '}
        <b>Enter</b> в превью подтверждает, <b>Открыть</b> — проверка по шагам
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

      <div className={selected ? 'queue-layout queue-layout--preview' : 'queue-layout'}>
        <Card className="queue-list" padded={false}>
          {loading && tickets.length === 0 && (
            <div className="queue-skeleton" aria-label="Загружаем очередь">
              {[0, 1, 2, 3].map((index) => (
                <span className="queue-skeleton__line" key={index} />
              ))}
            </div>
          )}

          {!loading && !error && visible.length === 0 && (
            <EmptyState
              title="Под фильтры ничего не подошло"
              hint="Измените фильтр или сбросьте его — новые заявки придут сами."
            >
              <Button variant="secondary" size="sm" onClick={() => setFilters(DEFAULT_FILTERS)}>
                Сбросить фильтры
              </Button>
            </EmptyState>
          )}

          {visible.length > 0 && (
            <div className="queue-table-wrap">
              <table className="queue-table">
                <thead>
                  <tr>
                    <th aria-label="Приоритет" />
                    <th>Обращение</th>
                    <th>Уверенность</th>
                    <th>Ждёт</th>
                    <th>Что сделать</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((ticket) => {
                    const info = details[ticket.id];
                    const action = queueAction(ticket, info?.signals);
                    const isFresh = fresh.has(ticket.id) || newIds.has(ticket.id);
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
                          if (event.key !== 'Enter' && event.key !== ' ') return;
                          if (event.key === 'Enter' && ticket.id === selectedId) return;
                          event.preventDefault();
                          event.stopPropagation();
                          setSelectedId(ticket.id);
                          trackAction?.('select');
                        }}
                      >
                        <td className="queue-cell-priority">
                          <PriorityMark priority={ticket.priority} isEmergency={ticket.isEmergency} />
                        </td>
                        <td>
                          <span className="queue-title">{info?.title ?? categoryLabel(meta, ticket.category)}</span>
                          <span className="queue-meta">
                            № {ticket.number} · {info?.location ?? 'место уточняется'}
                          </span>
                        </td>
                        <td>
                          <ConfidenceCell signals={info?.signals} />
                        </td>
                        <td className="queue-wait">{waitingLabel(ticket.createdAt, now)}</td>
                        <td>
                          <span className={`queue-action queue-action--${action.tone}`}>
                            <i className="queue-action__dot" aria-hidden="true" />
                            {action.text}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {selected && (
          <QueuePreview
            ticket={selected}
            detail={details[selected.id]?.detail ?? null}
            meta={meta}
            api={api}
            users={users}
            canConfirm={hasPermission(user.role, 'tickets.confirm')}
            navigate={navigate}
            onClose={() => setSelectedId(null)}
            onChanged={() => {
              markFresh([selected.id]);
              scheduleReload();
            }}
            trackAction={trackAction}
          />
        )}
      </div>
    </div>
  );
}
