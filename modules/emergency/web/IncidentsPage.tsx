import './emergency.css';
import { hasPermission } from '@ugra/contracts';
import type {
  AssigneeCandidate,
  Ticket,
  TicketAnalysisResponse,
  TicketListResponse,
  TicketResponse,
  User,
  UsersResponse,
} from '@ugra/contracts';
import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Card,
  EmptyState,
  Icon,
  PersonAvatar,
  Timer,
  Timeline,
  Toast,
  formatDateTime,
  formatTicketStatus,
  pulse,
  ticketStatusTone,
  useElapsed,
  useListMotion,
} from '@ugra/ui';
import type { ToastTone, WebPageProps } from '@ugra/ui';
import {
  MASS_THRESHOLD,
  MASS_WINDOW_MINUTES,
  incidentCards,
  incidentWindowMinutes,
  massDeclareRights,
  massTimeline,
  placeFromFields,
  readEmergencyVerdict,
  readIncidentDetail,
  similarTickets,
  sortByRecent,
  timelineItems,
  type IncidentCard,
  type IncidentDetailView,
  type Place,
} from './format';
import { IncidentHero } from './IncidentHero';
import { IncidentList } from './IncidentList';
import { IncidentMiniList } from './IncidentMiniList';
import { MassBlock } from './MassBlock';
import {
  assignmentState,
  isServiceEvent,
  plural,
  previousEmergencies,
  reactionNormMinutes,
  reactionState,
  reactionText,
  sanitizeTimeline,
} from './incident-view';
import { useNow } from './useNow';

const EMPTY_PLACE: Place = { building: null, cabinet: null, floor: null };
const EMPTY_EVENTS: readonly unknown[] = [];
const EMPTY_INCIDENTS: readonly IncidentCard[] = [];
const EMPTY_CANDIDATES: readonly AssigneeCandidate[] = [];
const INCIDENTS_URL = '/api/m/mass-incident/incidents';
/** Справочники, значения которых на экране — код: переводим по `meta.dictionaries`. */
const DICTIONARY_FIELDS = new Set([
  'category',
  'serviceType',
  'urgency',
  'priority',
  'impact',
  'criticality',
  'department',
  'channel',
  'equipmentType',
  'level',
]);

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Подпись категории из справочника; кода и «Без категории» на экране нет. */
function categoryLabel(meta: WebPageProps['meta'], code: string | null): string | null {
  if (!code) return null;
  const item = meta.dictionaries.find((entry) => entry.dictionary === 'category' && entry.code === code);
  return item?.label ?? null;
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (['INPUT', 'TEXTAREA', 'SELECT', 'SUMMARY'].includes(target.tagName)) return true;
  return target.closest('a[href]') !== null;
}

interface DemoIncidentResponse {
  created?: number;
  incidentId?: string;
}

/** Экран «Авария» (вариант B): слева — что делать, справа — время и исполнитель. */
export function IncidentsPage({ meta, api, user, trackAction }: WebPageProps): JSX.Element {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [allEmergency, setAllEmergency] = useState<Ticket[]>([]);
  const [allTickets, setAllTickets] = useState<Ticket[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [places, setPlaces] = useState<Record<string, Place>>({});
  const [detail, setDetail] = useState<TicketResponse | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<unknown>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisMissing, setAnalysisMissing] = useState(false);
  const [events, setEvents] = useState<readonly unknown[]>(EMPTY_EVENTS);
  const [eventsBlocked, setEventsBlocked] = useState(false);

  /** Отметки шагов регламента: время клика (мс) или `null`. Живут в состоянии экрана. */
  const [checks, setChecks] = useState<readonly (number | null)[]>([]);
  const [candidates, setCandidates] = useState<readonly AssigneeCandidate[]>(EMPTY_CANDIDATES);
  const [assigning, setAssigning] = useState(false);

  /* Массовость: список и карточка инцидента — с сервера, без локальной имитации. */
  const [incidents, setIncidents] = useState<readonly IncidentCard[]>(EMPTY_INCIDENTS);
  const [incidentsLoading, setIncidentsLoading] = useState(true);
  const [incidentsError, setIncidentsError] = useState<string | null>(null);
  const [pinnedIncidentId, setPinnedIncidentId] = useState<string | null>(null);
  const [incidentDetail, setIncidentDetail] = useState<IncidentDetailView | null>(null);
  const [incidentError, setIncidentError] = useState<string | null>(null);
  const [declaring, setDeclaring] = useState(false);
  const [massOpen, setMassOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: ToastTone } | null>(null);

  const rowsRef = useRef<HTMLDivElement | null>(null);
  const incidentRef = useRef<HTMLDivElement | null>(null);
  /** Сколько заявок создал демо-всплеск: тост показываем, когда карточка инцидента уже загружена. */
  const demoCreatedRef = useRef<number | null>(null);
  useListMotion(rowsRef, tickets.length > 0);

  const now = useNow(30_000);
  const selectedTicket = useMemo(
    () =>
      tickets.find((ticket) => ticket.id === selectedId) ??
      allTickets.find((ticket) => ticket.id === selectedId) ??
      null,
    [tickets, allTickets, selectedId],
  );
  const verdict = useMemo(() => readEmergencyVerdict(analysis), [analysis]);
  const checklist = useMemo(() => verdict?.checklist ?? [], [verdict]);
  const checklistSignature = checklist.join('|');
  const startedAt = detail?.appeal.createdAt ?? selectedTicket?.createdAt ?? null;
  const elapsed = useElapsed(startedAt);
  const rights = useMemo(() => massDeclareRights(user.role), [user.role]);
  const canConfirm = hasPermission(user.role, 'tickets.confirm');

  /* ---------- Список аварийных заявок ---------- */

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    void Promise.all([
      api.get<TicketListResponse>('/api/tickets?isEmergency=true&limit=50'),
      api.get<TicketListResponse>('/api/tickets?limit=200').catch(() => null),
      api.get<UsersResponse>('/api/users').catch(() => null),
    ])
      .then(([emergency, all, usersResponse]) => {
        if (!alive) return;
        const sorted = sortByRecent(
          emergency.tickets.filter((ticket) => ticket.status !== 'closed' && ticket.status !== 'cancelled'),
        );
        setTickets(sorted);
        setAllEmergency(emergency.tickets);
        setAllTickets(all?.tickets ?? emergency.tickets);
        setUsers(usersResponse?.users ?? []);
        setSelectedId((previous) =>
          previous !== null && sorted.some((ticket) => ticket.id === previous) ? previous : (sorted[0]?.id ?? null),
        );
        setError(null);
      })
      .catch((cause: unknown) => {
        if (alive) setError(errorText(cause));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [api, refreshToken]);

  /* ---------- Инциденты: список с сервера ---------- */

  useEffect(() => {
    let alive = true;
    setIncidentsLoading(true);
    void api
      .get<unknown>(INCIDENTS_URL)
      .then((response) => {
        if (!alive) return;
        setIncidents(incidentCards(response, { categoryLabel: (code) => categoryLabel(meta, code) ?? '' }));
        setIncidentsError(null);
      })
      .catch((cause: unknown) => {
        if (!alive) return;
        setIncidents(EMPTY_INCIDENTS);
        setIncidentsError(errorText(cause));
      })
      .finally(() => {
        if (alive) setIncidentsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [api, meta, refreshToken]);

  /* ---------- Место заявок списка (корпус и кабинет — в полях) ---------- */

  useEffect(() => {
    const missing = allEmergency.filter((ticket) => places[ticket.id] === undefined).slice(0, 40);
    if (missing.length === 0) return undefined;
    let alive = true;
    void Promise.all(
      missing.map(async (ticket) => {
        try {
          const response = await api.get<TicketResponse>(`/api/tickets/${ticket.id}`);
          return [ticket.id, placeFromFields(response.fields)] as const;
        } catch {
          return [ticket.id, EMPTY_PLACE] as const;
        }
      }),
    ).then((entries) => {
      if (!alive) return;
      setPlaces((previous) => {
        const next: Record<string, Place> = { ...previous };
        for (const [id, place] of entries) next[id] = place;
        return next;
      });
    });
    return () => {
      alive = false;
    };
  }, [allEmergency, places, api]);

  /* ---------- Место кандидатов «похожих»: только та же категория ---------- */

  useEffect(() => {
    if (!selectedTicket?.category) return undefined;
    const missing = allTickets
      .filter((ticket) => ticket.category === selectedTicket.category && places[ticket.id] === undefined)
      .slice(0, 40);
    if (missing.length === 0) return undefined;
    let alive = true;
    void Promise.all(
      missing.map(async (ticket) => {
        try {
          const response = await api.get<TicketResponse>(`/api/tickets/${ticket.id}`);
          return [ticket.id, placeFromFields(response.fields)] as const;
        } catch {
          return [ticket.id, EMPTY_PLACE] as const;
        }
      }),
    ).then((entries) => {
      if (!alive) return;
      setPlaces((previous) => {
        const next: Record<string, Place> = { ...previous };
        for (const [id, place] of entries) next[id] = place;
        return next;
      });
    });
    return () => {
      alive = false;
    };
  }, [allTickets, selectedTicket?.id, selectedTicket?.category, places, api]);

  /* ---------- Выбранная авария: заявка, разбор, события ---------- */

  useEffect(() => {
    if (selectedId === null) {
      setDetail(null);
      setAnalysis(null);
      setAnalysisMissing(false);
      setEvents(EMPTY_EVENTS);
      setEventsBlocked(false);
      return undefined;
    }

    let alive = true;
    setDetail(null);
    setDetailError(null);
    setAnalysis(null);
    setAnalysisMissing(false);
    setAnalysisLoading(true);
    setEvents(EMPTY_EVENTS);
    setEventsBlocked(false);

    void api
      .get<TicketResponse>(`/api/tickets/${selectedId}`)
      .then((response) => {
        if (!alive) return;
        setDetail(response);
        setPlaces((previous) =>
          previous[selectedId] ? previous : { ...previous, [selectedId]: placeFromFields(response.fields) },
        );
      })
      .catch((cause: unknown) => {
        if (alive) setDetailError(errorText(cause));
      });

    void api
      .get<TicketAnalysisResponse>(`/api/tickets/${selectedId}/analysis`)
      .then((response) => {
        if (alive) setAnalysis(response.analysis);
      })
      .catch(() => {
        if (!alive) return;
        setAnalysis(null);
        setAnalysisMissing(true);
      })
      .finally(() => {
        if (alive) setAnalysisLoading(false);
      });

    void api
      .get<{ events?: unknown[] }>(`/api/tickets/${selectedId}/events`)
      .then((response) => {
        if (alive) setEvents(Array.isArray(response.events) ? response.events : EMPTY_EVENTS);
      })
      .catch(() => {
        if (alive) setEventsBlocked(true);
      });

    return () => {
      alive = false;
    };
  }, [api, selectedId, refreshToken]);

  /* ---------- Кандидаты на исполнителя для выбранной заявки ---------- */

  useEffect(() => {
    if (selectedId === null) {
      setCandidates(EMPTY_CANDIDATES);
      return undefined;
    }
    let alive = true;
    void api
      .get<{ candidates: AssigneeCandidate[] }>(`/api/m/routing/candidates/${selectedId}`)
      .then((response) => {
        if (alive) setCandidates(response.candidates);
      })
      .catch(() => {
        if (alive) setCandidates(EMPTY_CANDIDATES);
      });
    return () => {
      alive = false;
    };
  }, [api, selectedId, refreshToken]);

  /* ---------- Выбранная заявка: активный инцидент и его карточка ---------- */

  useEffect(() => {
    // Другая заявка — снимаем ручной выбор инцидента, показываем привязанный к ней.
    setPinnedIncidentId(null);
  }, [selectedId]);

  const activeIncidentId = pinnedIncidentId ?? selectedTicket?.incidentId ?? null;

  useEffect(() => {
    if (activeIncidentId === null) {
      setIncidentDetail(null);
      setIncidentError(null);
      return undefined;
    }

    let alive = true;
    setIncidentDetail(null);
    setIncidentError(null);
    void api
      .get<unknown>(`${INCIDENTS_URL}/${encodeURIComponent(activeIncidentId)}`)
      .then((response) => {
        if (!alive) return;
        const view = readIncidentDetail(response, {
          categoryLabel: (code) => categoryLabel(meta, code) ?? '',
        });
        setIncidentDetail(view);
        const created = demoCreatedRef.current;
        if (view !== null && created !== null) {
          demoCreatedRef.current = null;
          setToast({
            text: `Инцидент ${view.incident.number}: ${created} новых обращений, всего ${view.incident.size}, статус «${view.incident.statusLabel}».`,
            tone: 'ok',
          });
        }
      })
      .catch((cause: unknown) => {
        if (alive) setIncidentError(errorText(cause));
      });
    return () => {
      alive = false;
    };
  }, [api, activeIncidentId, meta, refreshToken]);

  useEffect(() => {
    if (incidentDetail !== null) pulse(incidentRef.current);
  }, [incidentDetail]);

  useEffect(() => {
    setChecks(checklist.map(() => null));
  }, [checklistSignature, checklist]);

  /* ---------- Массовость: заявки инцидента или окно по всем заявкам ---------- */

  const selectedPlace = selectedId === null ? null : (places[selectedId] ?? null);
  const similar = useMemo(() => {
    if (selectedTicket === null) return [];
    return similarTickets(allTickets.length > 0 ? allTickets : tickets, selectedTicket, (id) => places[id], {
      now,
      windowMinutes: MASS_WINDOW_MINUTES,
      includeTarget: true,
    });
  }, [allTickets, tickets, selectedTicket, places, now]);

  const massWindow = useMemo(
    () =>
      incidentDetail === null
        ? MASS_WINDOW_MINUTES
        : incidentWindowMinutes(incidentDetail.incident.openedAtIso, now),
    [incidentDetail, now],
  );
  const mass = useMemo(
    () =>
      massTimeline(incidentDetail?.tickets ?? similar, now, {
        windowMinutes: massWindow,
        threshold: MASS_THRESHOLD,
      }),
    [incidentDetail, similar, now, massWindow],
  );
  const massTotal = mass.total;

  useEffect(() => {
    setMassOpen(mass.thresholdMet || incidentDetail !== null);
  }, [selectedId, mass.thresholdMet, incidentDetail]);

  const userName = useCallback(
    (id: string | null): string | null =>
      id === null ? null : (users.find((item) => item.id === id)?.fullName ?? null),
    [users],
  );
  const meaningfulEvents = useMemo(() => events.filter((event) => !isServiceEvent(event)), [events]);
  const timeline = useMemo(
    () => timelineItems(meaningfulEvents, { resolveUser: userName }),
    [meaningfulEvents, userName],
  );
  const fieldLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    for (const field of meta.fields) labels[field.key] = field.label;
    return labels;
  }, [meta.fields]);
  const valueLabels = useMemo(() => {
    const labels: Record<string, Record<string, string>> = {};
    for (const item of meta.dictionaries) {
      if (!DICTIONARY_FIELDS.has(item.dictionary)) continue;
      const group = labels[item.dictionary] ?? {};
      group[item.code] = item.label;
      labels[item.dictionary] = group;
    }
    return labels;
  }, [meta.dictionaries]);
  const safeTimeline = useMemo(
    () => sanitizeTimeline(timeline, fieldLabels, valueLabels),
    [timeline, fieldLabels, valueLabels],
  );
  const previous = useMemo(
    () =>
      previousEmergencies(
        allEmergency.length > 0 ? allEmergency : tickets,
        selectedTicket,
        (id) => places[id],
      ),
    [allEmergency, tickets, selectedTicket, places],
  );

  const assignee = selectedTicket?.assigneeId
    ? (users.find((item) => item.id === selectedTicket.assigneeId) ?? null)
    : null;
  const topCandidate = candidates[0] ?? null;
  const candidateName = topCandidate === null ? null : userName(topCandidate.userId);
  const assignState =
    selectedTicket === null
      ? { allowed: false, hint: null }
      : assignmentState(selectedTicket, canConfirm);

  const normMinutes = selectedTicket === null ? null : reactionNormMinutes(selectedTicket);
  const normState = reactionState(normMinutes, elapsed);
  const normText = reactionText(normMinutes, elapsed);
  const slabFilled =
    normMinutes === null
      ? 0
      : normState === 'overdue'
        ? 4
        : Math.min(4, Math.floor((elapsed / (normMinutes * 60_000)) * 4));

  const toggleCheck = useCallback(
    (index: number): void => {
      setChecks((current) =>
        current.map((value, position) => (position === index ? (value === null ? Date.now() : null) : value)),
      );
      trackAction?.('select');
    },
    [trackAction],
  );

  const selectIncident = (id: string): void => {
    setPinnedIncidentId(id);
    trackAction?.('select');
  };

  const assign = useCallback(async (): Promise<void> => {
    if (selectedTicket === null || !assignState.allowed || assigning || topCandidate === null) return;
    setAssigning(true);
    setToast(null);
    trackAction?.('click');
    try {
      // «Ждёт ответа» → «на проверке» разрешён диспетчеру: аварию не ждём, забираем в работу.
      if (selectedTicket.status === 'waiting_applicant') {
        await api.post(`/api/tickets/${selectedTicket.id}/transition`, {
          to: 'in_review',
          reason: 'Авария: диспетчер берёт заявку в работу',
        });
      }
      await api.post(`/api/tickets/${selectedTicket.id}/confirm`, { assigneeId: topCandidate.userId });
      setToast({ text: `Назначен ${candidateName ?? 'исполнитель'}.`, tone: 'ok' });
      setRefreshToken((value) => value + 1);
      trackAction?.('system');
    } catch (cause) {
      setToast({ text: `Не удалось назначить: ${errorText(cause)}`, tone: 'danger' });
    } finally {
      setAssigning(false);
    }
  }, [
    api,
    assignState.allowed,
    assigning,
    candidateName,
    selectedTicket,
    topCandidate,
    trackAction,
  ]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Enter' || event.defaultPrevented || event.repeat) return;
      if (!assignState.allowed || assigning || isInteractiveTarget(event.target)) return;
      event.preventDefault();
      void assign();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [assign, assignState.allowed, assigning]);

  /**
   * Демо-всплеск: сервер создаёт похожие заявки и сразу склеивает их в инцидент.
   * Без конфетти и «ура» — авария не праздник. Право `admin` проверяет и сервер.
   */
  const declareIncident = useCallback(async (): Promise<void> => {
    if (!rights.allowed || declaring) return;
    setDeclaring(true);
    setToast(null);
    trackAction?.('click');
    try {
      const created = await api.post<DemoIncidentResponse>('/api/m/mass-incident/demo');
      const count = typeof created.created === 'number' ? created.created : 0;
      if (created.incidentId !== undefined && created.incidentId !== '') {
        demoCreatedRef.current = count;
        setPinnedIncidentId(created.incidentId);
      } else {
        setToast({
          text: `Заявки созданы (${count}), но порог массовости не пройден — инцидента нет.`,
          tone: 'warn',
        });
      }
      setRefreshToken((value) => value + 1);
      trackAction?.('system');
    } catch (cause) {
      setToast({ text: `Не удалось объявить инцидент: ${errorText(cause)}`, tone: 'danger' });
    } finally {
      setDeclaring(false);
    }
  }, [api, declaring, rights.allowed, trackAction]);

  const eventsSummary =
    safeTimeline.length === 0
      ? 'событий пока нет'
      : `${safeTimeline.length} ${plural(safeTimeline.length, 'событие', 'события', 'событий')}`;
  const previousSummary =
    previous.total === 0
      ? 'нет аварий в корпусе'
      : previous.open > 0
        ? previous.open === 1
          ? '1 не закрыта'
          : `${previous.open} не закрыты`
        : 'все закрыты';

  return (
    <div className="er-page">
      <h1 className="ugra-sr-only">Аварии</h1>

      {error !== null && (
        <Card tone="danger">
          <h2>API не отвечает</h2>
          <p className="ugra-muted">{error}</p>
          <Button variant="secondary" size="sm" onClick={() => setRefreshToken((value) => value + 1)}>
            Повторить
          </Button>
        </Card>
      )}

      {loading && tickets.length === 0 && error === null && (
        <Card>
          <p className="ugra-muted">Загружаем аварийные заявки…</p>
        </Card>
      )}

      {!loading && error === null && tickets.length === 0 && (
        <>
          <EmptyState
            title="Аварий нет — это хорошо"
            hint="Аварийных заявок сейчас нет. Экран обновится сам, когда ИИ найдёт признаки аварии в новом обращении."
            icon="✓"
          />
          {incidents.length > 0 && (
            <Card className="er-empty-mass">
              <IncidentMiniList
                incidents={incidents}
                activeId={activeIncidentId}
                loading={incidentsLoading}
                error={incidentsError}
                onSelect={selectIncident}
              />
            </Card>
          )}
        </>
      )}

      {tickets.length > 0 && (
        <div className="er-layout">
          <Card className="er-list" padded={false} as="section">
            <div className="er-list__head">
              <h2 className="er-list__title">Аварийные заявки</h2>
              <span className="er-list__count">{tickets.length}</span>
            </div>
            <div ref={rowsRef}>
              <IncidentList
                tickets={tickets}
                places={places}
                activeId={selectedId}
                now={now}
                loading={loading}
                onSelect={(id) => {
                  setSelectedId(id);
                  trackAction?.('select');
                }}
              />
            </div>
          </Card>

          <div className="er-main">
            {selectedTicket === null ? (
              <Card>
                <p className="ugra-muted">Выберите аварийную заявку слева.</p>
              </Card>
            ) : (
              <IncidentHero
                ticket={selectedTicket}
                detail={detail}
                detailError={detailError}
                verdict={verdict}
                analysisLoading={analysisLoading}
                analysisMissing={analysisMissing}
                categoryLabel={categoryLabel(meta, selectedTicket.category)}
                place={selectedPlace}
                checklist={checklist}
                checks={checks}
                onToggle={toggleCheck}
              />
            )}
          </div>

          {selectedTicket !== null && (
            <aside className="er-side">
              <Card className="er-timer-card" padded={false}>
                <div className="er-timer__label">С момента обращения</div>
                <Timer from={startedAt} className="er-timer__value" />
                <div className="er-slabs" aria-hidden="true">
                  {[0, 1, 2, 3].map((index) => (
                    <i key={index} className={index < slabFilled ? 'on' : undefined} />
                  ))}
                </div>
                <div className="er-slabs__axis">
                  <span>0</span>
                  <span className={`er-slabs__norm er-slabs__norm--${normState}`}>{normText}</span>
                </div>
              </Card>

              <Card className="er-owner" padded={false}>
                <div className="er-owner__head">
                  {assignee === null ? (
                    <span className="er-owner__empty" aria-hidden="true">
                      <Icon name="executors" size={20} />
                    </span>
                  ) : (
                    <PersonAvatar name={assignee.fullName} size={40} />
                  )}
                  <div className="er-owner__text">
                    <div className="er-owner__name">{assignee?.fullName ?? 'Не назначен'}</div>
                    <div className="er-owner__hint">
                      {assignee?.position ??
                        (candidateName === null ? 'Исполнитель не предложен' : `Предлагаем: ${candidateName}`)}
                    </div>
                  </div>
                </div>

                {assignee === null && (
                  <>
                    <Button
                      variant="primary"
                      block
                      loading={assigning}
                      disabled={!assignState.allowed || topCandidate === null}
                      onClick={() => void assign()}
                      title={
                        assignState.hint ??
                        (candidateName === null
                          ? 'Сервер не предложил исполнителя'
                          : `Назначить: ${candidateName} (Enter)`)
                      }
                    >
                      Назначить <span className="er-kbd">Enter</span>
                    </Button>
                    {assignState.hint !== null && <p className="er-owner__note">{assignState.hint}</p>}
                  </>
                )}
              </Card>

              <Card className="er-folds" padded={false}>
                <details
                  className="er-fold"
                  key={`mass-${selectedId}`}
                  open={massOpen}
                  onToggle={(event) => setMassOpen(event.currentTarget.open)}
                >
                  <summary className="er-fold__head">
                    <span className="er-fold__text">
                      <span className="er-fold__title">Массовый сбой?</span>
                      <span className="er-fold__summary">
                        {massTotal} {plural(massTotal, 'похожее', 'похожих', 'похожих')} · порог{' '}
                        {MASS_THRESHOLD}
                      </span>
                    </span>
                    <span className="er-fold__chevron" aria-hidden="true" />
                  </summary>
                  <div className="er-fold__body">
                    <MassBlock
                      mass={mass}
                      massTotal={massTotal}
                      massWindow={massWindow}
                      hasPlace={
                        incidentDetail !== null ||
                        (selectedPlace !== null && selectedPlace.building !== null)
                      }
                      incidentDetail={incidentDetail}
                      incidentError={incidentError}
                      incidentRef={incidentRef}
                      incidents={incidents}
                      incidentsLoading={incidentsLoading}
                      incidentsError={incidentsError}
                      activeIncidentId={activeIncidentId}
                      onSelectIncident={selectIncident}
                      rights={rights}
                      declaring={declaring}
                      onDeclare={() => void declareIncident()}
                    />
                  </div>
                </details>

                <details className="er-fold" key={`timeline-${selectedId}`}>
                  <summary className="er-fold__head">
                    <span className="er-fold__text">
                      <span className="er-fold__title">Хронология</span>
                      <span className="er-fold__summary">
                        {eventsBlocked ? 'журнал недоступен' : eventsSummary}
                      </span>
                    </span>
                    <span className="er-fold__chevron" aria-hidden="true" />
                  </summary>
                  <div className="er-fold__body">
                    {eventsBlocked ? (
                      <p className="er-note">
                        События заявки недоступны: маршрут вернул ошибку или нет права смотреть журнал.
                      </p>
                    ) : (
                      <Timeline items={safeTimeline} empty="Событий пока нет" />
                    )}
                  </div>
                </details>

                <details className="er-fold" key={`previous-${selectedId}`}>
                  <summary className="er-fold__head">
                    <span className="er-fold__text">
                      <span className="er-fold__title">
                        Ранее{previous.total > 0 ? ` · ${previous.total}` : ''}
                      </span>
                      <span className="er-fold__summary">{previousSummary}</span>
                    </span>
                    <span className="er-fold__chevron" aria-hidden="true" />
                  </summary>
                  <div className="er-fold__body">
                    {previous.total === 0 ? (
                      <p className="er-note">Ранее аварий в этом корпусе не было.</p>
                    ) : (
                      <>
                        {previous.lastAt !== null && (
                          <p className="er-note">Последняя — {formatDateTime(previous.lastAt)}.</p>
                        )}
                        <div className="er-prev">
                          {previous.items.map((ticket) => (
                            <button
                              type="button"
                              key={ticket.id}
                              className="er-prev__row"
                              onClick={() => {
                                setSelectedId(ticket.id);
                                trackAction?.('select');
                              }}
                            >
                              <span className="er-prev__num">№ {ticket.number}</span>
                              <span className="er-prev__date">{formatDateTime(ticket.createdAt)}</span>
                              <span className={`er-status er-status--${ticketStatusTone(ticket.status)}`}>
                                <span className="er-status__dot" aria-hidden="true" />
                                {formatTicketStatus(ticket.status)}
                              </span>
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </details>
              </Card>
            </aside>
          )}
        </div>
      )}

      <Toast message={toast?.text ?? null} tone={toast?.tone ?? 'ok'} onClose={() => setToast(null)} />
    </div>
  );
}
