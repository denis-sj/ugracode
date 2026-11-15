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
import { Button, Card, Chip, EmptyState, Icon, SearchField, formatDateTime, useListMotion } from '@ugra/ui';
import type { WebPageProps } from '@ugra/ui';
import { Kbd } from './parts';
import {
  DEFAULT_FILTERS,
  fieldDisplayValue,
  filterTickets,
  formatLocation,
  groupTicketFields,
  locationFromTicket,
  promoteNew,
  queueAction,
  queueEventAction,
  queueFiltersFromQuery,
  sortTickets,
  STATUS_LABELS,
  ticketSignals,
  ticketTitleFromFields,
  visibleReviewGroups,
  waitingLabel,
} from './format';
import type { QueueSignals, TicketFilters, UiTone } from './format';
import { boardSize, boardTickets, featuredEmergency, unclearNote } from './queue-groups';
import type { QueueDetailAction, QueueDetailField, QueueQuietGroupView, QueueStateView } from './QueueSections';
import { QueueAlarm, QueueCard, QueueColumn, QueueDetail, QueueQuiet } from './QueueSections';
import { useNow } from './useNow';

/** Сколько заявок догружаем деталями для уверенности и места (кэш до перезагрузки). */
const DETAIL_LIMIT = 24;
/** Страховочный опрос, если SSE недоступен. */
const POLL_MS = 15_000;
/** Подсветка новых и изменившихся карточек. */
const FRESH_MS = 12_000;
/** Сколько висит сообщение о результате подтверждения. */
const NOTICE_MS = 8000;
/** Сколько карточек показываем в колонке до клика «Ещё». */
const COLUMN_LIMIT = 3;
/** Сколько полей заявки показываем в карточке-детали. */
const DETAIL_FIELDS = 6;

interface QueueDetail {
  detail: TicketResponse | null;
  signals: QueueSignals;
  location: string;
  title: string;
}

type FoldKey = 'engineer' | 'waiting' | 'drafting';
type ColumnKey = 'decision' | 'ready' | 'emergencies';

interface QueueNotice {
  tone: 'ok' | 'danger';
  text: string;
}

/** Тон «что сделать» → тон точки-статуса на карточке. */
const STATE_TONE: Record<UiTone, QueueStateView['tone']> = {
  neutral: 'neutral',
  accent: 'accent',
  ok: 'ok',
  warn: 'warn',
  danger: 'danger',
  info: 'info',
  muted: 'muted',
  emergency: 'danger',
  critical: 'danger',
  high: 'warn',
  medium: 'info',
  low: 'muted',
};

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

/** Очередь диспетчера: доска карточек по статусам, полоса аварии и карточка-деталь. */
export function QueuePage({ user, meta, api, navigate, query, trackAction }: WebPageProps): JSX.Element {
  const queryKey = query.toString();
  const initialFilters = useMemo(() => queueFiltersFromQuery(new URLSearchParams(queryKey)), [queryKey]);
  const [filters, setFilters] = useState<TicketFilters>(initialFilters);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [details, setDetails] = useState<Record<string, QueueDetail>>({});
  const [routing, setRouting] = useState<Record<string, AssigneeCandidate[]>>({});
  const [users, setUsers] = useState<User[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openFold, setOpenFold] = useState<Record<FoldKey, boolean>>({
    engineer: false,
    waiting: false,
    drafting: false,
  });
  const [expanded, setExpanded] = useState<Record<ColumnKey, boolean>>({
    decision: false,
    ready: false,
    emergencies: false,
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
  const routingLoadedRef = useRef<Set<string>>(new Set());
  const freshTimerRef = useRef<number | null>(null);
  const reloadTimerRef = useRef<number | null>(null);
  const busyRef = useRef(false);
  const detailRef = useRef<HTMLDivElement | null>(null);
  const decisionRef = useRef<HTMLDivElement | null>(null);
  const readyRef = useRef<HTMLDivElement | null>(null);
  const emergencyRef = useRef<HTMLDivElement | null>(null);
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

  /** Предложение исполнителя для открытой карточки: один запрос на заявку. */
  useEffect(() => {
    if (selectedId === null || routingLoadedRef.current.has(selectedId)) return undefined;
    routingLoadedRef.current.add(selectedId);
    let alive = true;
    api
      .get<{ candidates: AssigneeCandidate[] }>(`/api/m/routing/candidates/${selectedId}`)
      .then((response) => {
        if (!alive) return;
        setRouting((previous) => ({ ...previous, [selectedId]: response.candidates }));
      })
      .catch(() => {
        if (!alive) return;
        setRouting((previous) => ({ ...previous, [selectedId]: [] }));
      });
    return () => {
      alive = false;
    };
  }, [api, selectedId]);

  useEffect(() => {
    if (selectedId === null) return;
    detailRef.current?.focus({ preventScroll: true });
  }, [selectedId]);

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
  const board = useMemo(() => boardTickets(visible, signals), [visible, signals]);
  const total = boardSize(board);
  /** Аварию с закреплённой полосы в колонке не повторяем. */
  const emergencyCards = useMemo(
    () => board.emergencies.filter((ticket) => ticket.id !== alarmTicket?.id),
    [board.emergencies, alarmTicket],
  );
  const selectedTicket = useMemo(
    () => (selectedId === null ? null : (visible.find((ticket) => ticket.id === selectedId) ?? null)),
    [visible, selectedId],
  );
  const selectedReady = useMemo(
    () =>
      selectedId === null ? null : (board.ready.find((ticket) => ticket.id === selectedId) ?? null),
    [board.ready, selectedId],
  );

  useListMotion(decisionRef, board.decision.length > 0);
  useListMotion(readyRef, board.ready.length > 0);
  useListMotion(emergencyRef, emergencyCards.length > 0);
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
  const stateOf = useCallback(
    (ticket: Ticket): QueueStateView => {
      const action = queueAction(ticket, signals[ticket.id]);
      return { tone: STATE_TONE[action.tone], text: action.text };
    },
    [signals],
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
      const cached = routing[ticket.id]?.[0]?.userId;
      if (cached) return cached;
      try {
        const response = await api.get<{ candidates: AssigneeCandidate[] }>(
          `/api/m/routing/candidates/${ticket.id}`,
        );
        return response.candidates[0]?.userId ?? null;
      } catch {
        return null;
      }
    },
    [api, routing],
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
      if (selectedId !== null) {
        if (selectedReady) {
          event.preventDefault();
          void confirmTickets([selectedReady]);
        }
        return;
      }
      if (board.ready.length > 0) {
        event.preventDefault();
        void confirmTickets(board.ready);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [confirmTickets, board.ready, selectedId, selectedReady]);

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

  const openCard = (ticketId: string): void => {
    setSelectedId(ticketId);
    trackAction?.('select');
    setNotice(null);
  };

  const toggleColumn = (key: ColumnKey): void => {
    setExpanded((previous) => ({ ...previous, [key]: !previous[key] }));
  };

  const cardOf = (ticket: Ticket): JSX.Element => (
    <QueueCard
      key={ticket.id}
      ticket={ticket}
      title={titleOf(ticket)}
      place={placeOf(ticket)}
      state={stateOf(ticket)}
      confidence={details[ticket.id]?.signals.confidence ?? null}
      wait={waitingLabel(ticket.createdAt, now)}
      fresh={fresh.has(ticket.id) || newIds.has(ticket.id)}
      selected={ticket.id === selectedId}
      onOpen={() => openCard(ticket.id)}
    />
  );

  const columnCards = (list: readonly Ticket[], key: ColumnKey): JSX.Element[] =>
    (expanded[key] ? list : list.slice(0, COLUMN_LIMIT)).map(cardOf);

  /** Одна строка-перечисление для свёрнутой полосы: две заявки и «и ещё N». */
  const summaryOf = (list: readonly Ticket[]): string => {
    if (list.length === 0) return '';
    const head = list
      .slice(0, 2)
      .map(titleOf)
      .join(' · ');
    return list.length > 2 ? `${head} и ещё ${list.length - 2}` : head;
  };

  const moreChip = (list: readonly Ticket[], key: ColumnKey): JSX.Element | null =>
    list.length > COLUMN_LIMIT ? (
      <div className="queue-column__more">
        <Chip
          active={expanded[key]}
          onClick={() => toggleColumn(key)}
          title={expanded[key] ? 'Свернуть колонку' : 'Показать все'}
        >
          {expanded[key] ? 'Свернуть' : `Ещё ${list.length - COLUMN_LIMIT}`}
        </Chip>
      </div>
    ) : null;

  const quietGroups: QueueQuietGroupView[] = [
    {
      key: 'engineer',
      title: 'Ждут инженера',
      count: board.withEngineer.length,
      summary: summaryOf(board.withEngineer),
      open: openFold.engineer,
      onToggle: () => setOpenFold((previous) => ({ ...previous, engineer: !previous.engineer })),
      listRef: engineerRef,
      items: board.withEngineer.map((ticket) => ({
        id: ticket.id,
        number: ticket.number,
        title: titleOf(ticket),
        note: engineerOf(ticket) ?? (ticket.status === 'in_progress' ? 'в работе' : 'ждёт'),
        onOpen: () => openCard(ticket.id),
      })),
    },
    {
      key: 'waiting',
      title: 'Ждут заявителя',
      count: board.waitingApplicant.length,
      summary: summaryOf(board.waitingApplicant),
      open: openFold.waiting,
      onToggle: () => setOpenFold((previous) => ({ ...previous, waiting: !previous.waiting })),
      listRef: waitingRef,
      items: board.waitingApplicant.map((ticket) => ({
        id: ticket.id,
        number: ticket.number,
        title: titleOf(ticket),
        note: 'ждёт ответа',
        onOpen: () => openCard(ticket.id),
      })),
    },
    {
      key: 'drafting',
      title: 'ИИ разбирает',
      count: board.drafting.length,
      summary: summaryOf(board.drafting),
      open: openFold.drafting,
      onToggle: () => setOpenFold((previous) => ({ ...previous, drafting: !previous.drafting })),
      listRef: draftingRef,
      items: board.drafting.map((ticket) => ({
        id: ticket.id,
        number: ticket.number,
        title: titleOf(ticket),
        note: 'собирает',
        onOpen: () => openCard(ticket.id),
      })),
    },
  ];

  const alarmInfo = alarmTicket ? details[alarmTicket.id] : undefined;

  const detailFields: QueueDetailField[] = useMemo(() => {
    const source = selectedTicket ? details[selectedTicket.id]?.detail : null;
    if (!source) return [];
    return visibleReviewGroups(groupTicketFields(source.fields, meta.fields))
      .flatMap((group) =>
        group.fields.map((entry) => ({
          key: entry.key,
          label: entry.label,
          value: fieldDisplayValue(meta, entry.key, entry.value),
          review: entry.field?.needsReview === true,
        })),
      )
      .slice(0, DETAIL_FIELDS);
  }, [details, meta, selectedTicket]);

  const selectedCandidate = useMemo(() => {
    if (!selectedTicket) return null;
    const top = routing[selectedTicket.id]?.[0];
    if (!top) return null;
    const human = top.reasons.filter((reason) => !reason.startsWith('навык'));
    return {
      name: users.find((candidate) => candidate.id === top.userId)?.fullName ?? 'Инженер',
      reasons: (human.length > 0 ? human : top.reasons).slice(0, 2),
    };
  }, [routing, selectedTicket, users]);

  const selectedAssignee = selectedTicket ? engineerOf(selectedTicket) : null;
  const selectedBusy = selectedTicket ? pendingIds.has(selectedTicket.id) : false;

  const detailActions = useMemo<{
    primary?: QueueDetailAction;
    secondary?: QueueDetailAction;
  }>(() => {
    if (!selectedTicket) return {};
    if (selectedReady) {
      return {
        primary: canConfirm
          ? {
              label: 'Подтвердить',
              onClick: () => void confirmTickets([selectedReady]),
              loading: selectedBusy,
            }
          : { label: 'Проверить', onClick: () => openReview(selectedReady.id) },
        secondary: canConfirm ? { label: 'Открыть', onClick: () => openReview(selectedReady.id) } : undefined,
      };
    }
    if (selectedTicket.status === 'in_review') {
      return { primary: { label: 'Проверить', onClick: () => openReview(selectedTicket.id) } };
    }
    return { primary: { label: 'Открыть заявку', onClick: () => openReview(selectedTicket.id) } };
  }, [canConfirm, confirmTickets, openReview, selectedBusy, selectedReady, selectedTicket]);

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
                : 'Новые заявки появятся здесь сами: ИИ разберёт обращение и разложит по колонкам.'
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

      {!error && total > 0 && (
        <div className="queue-board">
          <QueueColumn
            title="Сомнительные"
            tone="warn"
            count={board.decision.length}
            note={board.decision.length > 0 ? 'ИИ не уверен' : undefined}
            empty="Спорных нет"
            listRef={decisionRef}
          >
            {columnCards(board.decision, 'decision')}
            {moreChip(board.decision, 'decision')}
          </QueueColumn>

          <QueueColumn
            title="Готовые"
            tone="ok"
            count={board.ready.length}
            action={
              canConfirm && board.ready.length > 0 ? (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={pendingAll}
                  onClick={() => void confirmTickets(board.ready)}
                  title="Подтвердить все заявки колонки"
                >
                  Подтвердить все <Kbd>Enter</Kbd>
                </Button>
              ) : undefined
            }
            empty="Готовых к подтверждению нет"
            listRef={readyRef}
          >
            {columnCards(board.ready, 'ready')}
            {moreChip(board.ready, 'ready')}
          </QueueColumn>

          <QueueColumn
            title="Аварии"
            tone="danger"
            count={emergencyCards.length}
            note={alarmTicket ? 'ещё одна — на полосе выше' : undefined}
            empty={alarmTicket ? 'Других аварий нет' : 'Аварий нет'}
            listRef={emergencyRef}
          >
            {columnCards(emergencyCards, 'emergencies')}
            {moreChip(emergencyCards, 'emergencies')}
          </QueueColumn>
        </div>
      )}

      {!error && <QueueQuiet groups={quietGroups} />}

      {!error && selectedTicket && (
        <div className="queue-drawer">
          <button
            type="button"
            className="queue-drawer__scrim"
            aria-label="Закрыть карточку заявки"
            onClick={() => setSelectedId(null)}
          />
          <QueueDetail
            panelRef={detailRef}
            ticket={selectedTicket}
            title={titleOf(selectedTicket)}
            place={placeOf(selectedTicket)}
            state={stateOf(selectedTicket)}
            wait={waitingLabel(selectedTicket.createdAt, now)}
            created={formatDateTime(selectedTicket.createdAt)}
            note={unclearNote(details[selectedTicket.id]?.detail?.fields, meta.fields)}
            fields={detailFields}
            assignee={selectedAssignee}
            candidate={selectedCandidate}
            now={now}
            primary={detailActions.primary}
            secondary={detailActions.secondary}
            canConfirm={Boolean(selectedReady) && canConfirm}
            onClose={() => setSelectedId(null)}
          />
        </div>
      )}
    </div>
  );
}
