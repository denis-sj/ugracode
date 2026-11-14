import './review.css';
import type {
  AssigneeCandidate,
  Ticket,
  TicketListResponse,
  TicketResponse,
  User,
  UsersResponse,
} from '@ugra/contracts';
import { hasPermission } from '@ugra/contracts';
import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, EmptyState, Icon, SearchField, useListMotion } from '@ugra/ui';
import type { WebPageProps } from '@ugra/ui';
import { Kbd } from './parts';
import {
  DEFAULT_FILTERS,
  filterTickets,
  formatLocation,
  locationFromTicket,
  promoteNew,
  queueEventAction,
  queueFiltersFromQuery,
  sortTickets,
  STATUS_LABELS,
  ticketSignals,
  ticketTitleFromFields,
  waitingLabel,
} from './format';
import type { QueueSignals, TicketFilters } from './format';
import { featuredEmergency, groupTickets, queueSize, unclearNote } from './queue-groups';
import type { QueueStateView } from './QueueSections';
import { QueueAlarm, QueueFold, QueueGroup, QueueRow } from './QueueSections';
import { useNow } from './useNow';

/** Сколько строк догружаем деталями для уверенности и места (кэш до перезагрузки). */
const DETAIL_LIMIT = 24;
/** Страховочный опрос, если SSE недоступен. */
const POLL_MS = 15_000;
/** Подсветка новых и изменившихся строк. */
const FRESH_MS = 12_000;
/** Сколько висит сообщение о результате подтверждения. */
const NOTICE_MS = 8000;

interface QueueDetail {
  detail: TicketResponse | null;
  signals: QueueSignals;
  location: string;
  title: string;
}

type FoldKey = 'engineer' | 'waiting' | 'drafting';

interface QueueNotice {
  tone: 'ok' | 'danger';
  text: string;
}

/** Подпись категории из справочника; служебный код на экран не выводим. */
function categoryLabel(meta: WebPageProps['meta'], code: string | null): string | null {
  if (!code) return null;
  return (
    meta.dictionaries.find((entry) => entry.dictionary === 'category' && entry.code === code)?.label ?? null
  );
}

function buildingLabel(meta: WebPageProps['meta'], code: string): string {
  return (
    meta.dictionaries.find((entry) => entry.dictionary === 'building' && entry.code === code)?.label ??
    'Корпус'
  );
}

/** Очередь диспетчера: полоса аварии, три смысловые группы и поиск. */
export function QueuePage({ user, meta, api, navigate, query, trackAction }: WebPageProps): JSX.Element {
  const queryKey = query.toString();
  const initialFilters = useMemo(() => queueFiltersFromQuery(new URLSearchParams(queryKey)), [queryKey]);
  const [filters, setFilters] = useState<TicketFilters>(initialFilters);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [details, setDetails] = useState<Record<string, QueueDetail>>({});
  const [users, setUsers] = useState<User[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openFold, setOpenFold] = useState<Record<FoldKey, boolean>>({
    engineer: false,
    waiting: false,
    drafting: false,
  });
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [notice, setNotice] = useState<QueueNotice | null>(null);
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
  const busyRef = useRef(false);
  const decisionRef = useRef<HTMLDivElement | null>(null);
  const readyRef = useRef<HTMLDivElement | null>(null);
  const engineerRef = useRef<HTMLDivElement | null>(null);
  const waitingRef = useRef<HTMLDivElement | null>(null);
  const draftingRef = useRef<HTMLDivElement | null>(null);

  const canConfirm = hasPermission(user.role, 'tickets.confirm');

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
          .filter(
            (ticket) => previousUpdated.has(ticket.id) && previousUpdated.get(ticket.id) !== ticket.updatedAt,
          )
          .map((ticket) => ticket.id);
        const added = response.tickets
          .filter((ticket) => !previousIds.has(ticket.id))
          .map((ticket) => ticket.id);
        updatedAtRef.current = new Map(
          response.tickets.map((ticket) => [ticket.id, ticket.updatedAt] as const),
        );
        knownIdsRef.current = new Set(response.tickets.map((ticket) => ticket.id));
        setTickets(response.tickets);
        setError(null);
        if (mode === 'quiet') markFresh(changed, added);
        setSelectedId((current) =>
          current && !response.tickets.some((ticket) => ticket.id === current) ? null : current,
        );
      } catch (cause) {
        if (mode === 'loud')
          setError(cause instanceof Error ? cause.message : 'Не удалось загрузить очередь');
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
        (ticket) => !loadedDetailsRef.current.has(ticket.id) && !detailsInFlightRef.current.has(ticket.id),
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
              location: formatLocation(locationFromTicket(detail.ticket, detail.fields), (code) =>
                buildingLabel(meta, code),
              ),
              title: ticketTitleFromFields(detail.fields, (key, value) => {
                if (key === 'category') return categoryLabel(meta, value) ?? 'Обращение';
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
              title: categoryLabel(meta, ticket.category) ?? 'Обращение',
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

  useEffect(() => {
    if (notice === null) return undefined;
    const timer = window.setTimeout(() => setNotice(null), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

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

  const visible = useMemo(
    () => promoteNew(sortTickets(filterTickets(tickets, filters, { signals, locations })), newIds),
    [tickets, filters, signals, locations, newIds],
  );
  const alarmTicket = useMemo(
    () => featuredEmergency(sortTickets(filterTickets(tickets, DEFAULT_FILTERS))),
    [tickets],
  );
  const groups = useMemo(
    () =>
      groupTickets(
        visible.filter((ticket) => ticket.id !== alarmTicket?.id),
        signals,
      ),
    [visible, signals, alarmTicket],
  );
  const total = queueSize(groups);
  const selectedReady = useMemo(
    () => (selectedId ? (groups.ready.find((ticket) => ticket.id === selectedId) ?? null) : null),
    [groups.ready, selectedId],
  );

  useListMotion(decisionRef, groups.decision.length > 0);
  useListMotion(readyRef, groups.ready.length > 0);
  useListMotion(engineerRef, openFold.engineer);
  useListMotion(waitingRef, openFold.waiting);
  useListMotion(draftingRef, openFold.drafting);

  const titleOf = useCallback(
    (ticket: Ticket): string =>
      details[ticket.id]?.title ?? categoryLabel(meta, ticket.category) ?? 'Обращение',
    [details, meta],
  );
  const placeOf = useCallback(
    (ticket: Ticket): string => details[ticket.id]?.location ?? 'место уточняется',
    [details],
  );
  const engineerOf = useCallback(
    (ticket: Ticket): string | null => {
      const name = users.find((candidate) => candidate.id === ticket.assigneeId)?.fullName;
      return name ?? (ticket.assigneeId ? 'Инженер' : null);
    },
    [users],
  );

  const openReview = useCallback(
    (ticketId: string): void => {
      trackAction?.('navigate');
      navigate(`/review?id=${encodeURIComponent(ticketId)}`);
    },
    [navigate, trackAction],
  );

  const resolveAssignee = useCallback(
    async (ticket: Ticket): Promise<string | null> => {
      if (ticket.assigneeId) return ticket.assigneeId;
      try {
        const response = await api.get<{ candidates: AssigneeCandidate[] }>(
          `/api/m/routing/candidates/${ticket.id}`,
        );
        return response.candidates[0]?.userId ?? null;
      } catch {
        return null;
      }
    },
    [api],
  );

  const confirmTickets = useCallback(
    async (targets: readonly Ticket[]): Promise<void> => {
      const list = targets.filter((ticket) => ticket.status === 'in_review');
      if (list.length === 0 || !canConfirm || busyRef.current) return;
      busyRef.current = true;
      setNotice(null);
      setPendingIds(new Set(list.map((ticket) => ticket.id)));
      const confirmed: string[] = [];
      let withoutAssignee = 0;
      let failure: string | null = null;
      for (const ticket of list) {
        const assigneeId = await resolveAssignee(ticket);
        if (!assigneeId) {
          withoutAssignee += 1;
          continue;
        }
        try {
          await api.post(`/api/tickets/${ticket.id}/confirm`, { assigneeId });
          confirmed.push(ticket.id);
        } catch (cause) {
          failure = cause instanceof Error ? cause.message : 'Не удалось подтвердить заявку';
        }
      }
      busyRef.current = false;
      setPendingIds(new Set<string>());
      if (confirmed.length > 0) {
        markFresh(confirmed);
        setSelectedId((current) => (current && confirmed.includes(current) ? null : current));
        trackAction?.('system');
        await load('quiet');
      }
      const parts: string[] = [];
      if (confirmed.length > 0) {
        parts.push(
          list.length === 1 ? 'Заявка подтверждена и назначена.' : `Подтверждено: ${confirmed.length}.`,
        );
      }
      if (withoutAssignee > 0) parts.push(`без исполнителя: ${withoutAssignee}`);
      if (failure) parts.push(failure);
      setNotice({
        tone: confirmed.length > 0 && !failure ? 'ok' : 'danger',
        text: parts.length === 0 ? 'Не удалось подтвердить заявки.' : parts.join(' · '),
      });
    },
    [api, canConfirm, load, markFresh, resolveAssignee, trackAction],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setSelectedId(null);
        return;
      }
      if (event.key !== 'Enter' || event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest('input, textarea, select, button, a, [contenteditable="true"]')
      ) {
        return;
      }
      if (selectedReady) {
        event.preventDefault();
        void confirmTickets([selectedReady]);
        return;
      }
      if (groups.ready.length > 0) {
        event.preventDefault();
        void confirmTickets(groups.ready);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [confirmTickets, groups.ready, selectedReady]);

  const scope = useMemo(() => {
    const parts: string[] = [];
    if (filters.onlyEmergency) parts.push('только аварии');
    if (filters.status !== 'all') parts.push(`статус: ${STATUS_LABELS[filters.status]}`);
    if (filters.assignee !== '') {
      parts.push(
        `исполнитель: ${users.find((candidate) => candidate.id === filters.assignee)?.fullName ?? 'выбранный'}`,
      );
    }
    return parts;
  }, [filters.assignee, filters.onlyEmergency, filters.status, users]);

  const hasQuery = filters.query.trim() !== '';
  const pendingAll = pendingIds.size > 0;

  const selectRow = (ticketId: string): void => {
    setSelectedId((current) => (current === ticketId ? null : ticketId));
    trackAction?.('select');
    setNotice(null);
  };

  const alarmInfo = alarmTicket ? details[alarmTicket.id] : undefined;

  return (
    <div className="queue-page">
      <header className="queue-head">
        <div>
          <h1 className="ugra-page-title">Очередь</h1>
          <p className="queue-lead">ИИ разобрал обращения — проверьте спорные и подтвердите готовые.</p>
        </div>
        <SearchField
          className="queue-search"
          value={filters.query}
          label="Поиск заявок"
          placeholder="Номер, кабинет, текст"
          onChange={(value) => {
            setFilters((previous) => ({ ...previous, query: value }));
            trackAction?.('input');
          }}
        />
      </header>

      {scope.length > 0 && (
        <div className="queue-scope">
          <span>Показаны: {scope.join(' · ')}</span>
          <button
            type="button"
            className="queue-link"
            onClick={() => setFilters((previous) => ({ ...DEFAULT_FILTERS, query: previous.query }))}
          >
            Сбросить
          </button>
        </div>
      )}

      {notice && (
        <p
          className={`queue-notice queue-notice--${notice.tone}`}
          role={notice.tone === 'danger' ? 'alert' : 'status'}
        >
          {notice.text}
        </p>
      )}

      {error && (
        <Card tone="danger" className="queue-error">
          <h2 className="queue-error__title">API не отвечает</h2>
          <p className="ugra-muted">Не удалось загрузить очередь: {error}</p>
          <Button variant="secondary" size="sm" onClick={() => void load()}>
            Повторить
          </Button>
        </Card>
      )}

      {alarmTicket && (
        <QueueAlarm
          ticket={alarmTicket}
          title={alarmInfo?.title ?? 'Авария на объекте'}
          place={alarmInfo?.location ?? 'место уточняется'}
          onOpen={() => openReview(alarmTicket.id)}
        />
      )}

      {loading && tickets.length === 0 && (
        <Card padded={false}>
          <div className="queue-skeleton" aria-label="Загружаем очередь">
            {[0, 1, 2, 3].map((index) => (
              <span className="queue-skeleton__line" key={index} />
            ))}
          </div>
        </Card>
      )}

      {!loading && !error && total === 0 && (!alarmTicket || hasQuery || scope.length > 0) && (
        <EmptyState
          title={
            hasQuery ? 'Ничего не нашли' : scope.length > 0 ? 'Под фильтр ничего не подошло' : 'Очередь пуста'
          }
          hint={
            hasQuery
              ? 'Проверьте номер, кабинет или текст обращения.'
              : scope.length > 0
                ? 'Сбросьте фильтр — остальные заявки на месте.'
                : 'Новые заявки появятся здесь сами: ИИ разберёт обращение и разложит по группам.'
          }
          icon={<Icon name="queue" size={28} />}
        >
          {(hasQuery || scope.length > 0) && (
            <Button variant="secondary" size="sm" onClick={() => setFilters(DEFAULT_FILTERS)}>
              {hasQuery ? 'Очистить поиск' : 'Сбросить фильтр'}
            </Button>
          )}
        </EmptyState>
      )}

      {groups.decision.length > 0 && (
        <QueueGroup
          title="Нужно ваше решение"
          count={groups.decision.length}
          note="ИИ не уверен — проверьте поля"
          decision
        >
          <div className="queue-group__rows" ref={decisionRef}>
            {groups.decision.map((ticket) => (
              <QueueRow
                key={ticket.id}
                ticket={ticket}
                variant="decision"
                title={titleOf(ticket)}
                meta={`№ ${ticket.number} · ${placeOf(ticket)}`}
                why={unclearNote(details[ticket.id]?.detail?.fields, meta.fields)}
                confidence={details[ticket.id]?.signals.confidence ?? null}
                wait={waitingLabel(ticket.createdAt, now)}
                fresh={fresh.has(ticket.id) || newIds.has(ticket.id)}
                action={
                  <Button variant="primary" size="sm" onClick={() => openReview(ticket.id)}>
                    Проверить
                  </Button>
                }
              />
            ))}
          </div>
        </QueueGroup>
      )}

      {groups.ready.length > 0 && (
        <QueueGroup
          title="Готовы к подтверждению"
          count={groups.ready.length}
          action={
            canConfirm ? (
              <Button
                variant="secondary"
                size="sm"
                loading={pendingAll}
                onClick={() => void confirmTickets(groups.ready)}
                title="Подтвердить все заявки группы"
              >
                Подтвердить все <Kbd>Enter</Kbd>
              </Button>
            ) : undefined
          }
        >
          <div className="queue-group__rows" ref={readyRef}>
            {groups.ready.map((ticket) => (
              <QueueRow
                key={ticket.id}
                ticket={ticket}
                variant="ready"
                title={titleOf(ticket)}
                meta={`№ ${ticket.number} · ${placeOf(ticket)}`}
                confidence={details[ticket.id]?.signals.confidence ?? null}
                wait={waitingLabel(ticket.createdAt, now)}
                selectable
                selected={ticket.id === selectedId}
                fresh={fresh.has(ticket.id) || newIds.has(ticket.id)}
                onSelect={() => selectRow(ticket.id)}
                action={
                  <button
                    type="button"
                    className="queue-link"
                    onClick={(event) => {
                      event.stopPropagation();
                      openReview(ticket.id);
                    }}
                  >
                    Открыть
                  </button>
                }
              />
            ))}
          </div>
        </QueueGroup>
      )}

      {groups.withEngineer.length > 0 && (
        <QueueFold
          title="Ждут инженера"
          count={groups.withEngineer.length}
          summary={groups.withEngineer.map(titleOf).join(' · ')}
          open={openFold.engineer}
          onToggle={() => setOpenFold((previous) => ({ ...previous, engineer: !previous.engineer }))}
        >
          <div className="queue-group__rows" ref={engineerRef}>
            {groups.withEngineer.map((ticket) => {
              const state: QueueStateView =
                ticket.status === 'in_progress'
                  ? { tone: 'accent', text: 'В работе' }
                  : { tone: 'muted', text: 'Ждёт инженера' };
              return (
                <QueueRow
                  key={ticket.id}
                  ticket={ticket}
                  variant="engineer"
                  title={titleOf(ticket)}
                  meta={`№ ${ticket.number} · ${placeOf(ticket)}`}
                  state={state}
                  wait={waitingLabel(ticket.createdAt, now)}
                  fresh={fresh.has(ticket.id) || newIds.has(ticket.id)}
                  engineer={engineerOf(ticket)}
                />
              );
            })}
          </div>
        </QueueFold>
      )}

      {groups.waitingApplicant.length > 0 && (
        <QueueFold
          title="Ждут заявителя"
          count={groups.waitingApplicant.length}
          summary={groups.waitingApplicant.map(titleOf).join(' · ')}
          open={openFold.waiting}
          onToggle={() => setOpenFold((previous) => ({ ...previous, waiting: !previous.waiting }))}
        >
          <div className="queue-group__rows" ref={waitingRef}>
            {groups.waitingApplicant.map((ticket) => (
              <QueueRow
                key={ticket.id}
                ticket={ticket}
                variant="waiting"
                title={titleOf(ticket)}
                meta={`№ ${ticket.number} · ${placeOf(ticket)}`}
                state={{ tone: 'info', text: 'Ждёт ответа заявителя' }}
                wait={waitingLabel(ticket.createdAt, now)}
                fresh={fresh.has(ticket.id) || newIds.has(ticket.id)}
                action={
                  <button
                    type="button"
                    className="queue-link"
                    onClick={(event) => {
                      event.stopPropagation();
                      openReview(ticket.id);
                    }}
                  >
                    Открыть
                  </button>
                }
              />
            ))}
          </div>
        </QueueFold>
      )}

      {groups.drafting.length > 0 && (
        <QueueFold
          title="ИИ разбирает"
          count={groups.drafting.length}
          summary={groups.drafting.map(titleOf).join(' · ')}
          open={openFold.drafting}
          onToggle={() => setOpenFold((previous) => ({ ...previous, drafting: !previous.drafting }))}
        >
          <div className="queue-group__rows" ref={draftingRef}>
            {groups.drafting.map((ticket) => (
              <QueueRow
                key={ticket.id}
                ticket={ticket}
                variant="waiting"
                title={titleOf(ticket)}
                meta={`№ ${ticket.number} · ${placeOf(ticket)}`}
                state={{ tone: 'warn', text: 'ИИ собирает заявку' }}
                wait={waitingLabel(ticket.createdAt, now)}
                fresh={fresh.has(ticket.id) || newIds.has(ticket.id)}
              />
            ))}
          </div>
        </QueueFold>
      )}
    </div>
  );
}
