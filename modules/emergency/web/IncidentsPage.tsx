import './emergency.css';
import type {
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
  Badge,
  Button,
  Card,
  ConfidenceBar,
  DetailRow,
  EmptyState,
  Timeline,
  Toast,
  formatTicketStatus,
  ticketStatusTone,
  pulse,
  useElapsed,
  useListMotion,
} from '@ugra/ui';
import type { WebPageProps } from '@ugra/ui';
import type { Place } from './format';
import {
  MASS_THRESHOLD,
  MASS_WINDOW_MINUTES,
  channelLabel,
  emergencyLevelLabel,
  emergencyReason,
  eventTime,
  formatTimer,
  incidentNumber,
  incidentTimer,
  massTimeline,
  placeFromFields,
  placeLabel,
  quoteSegments,
  readEmergencyVerdict,
  similarTickets,
  sortByRecent,
  timelineItems,
} from './format';
import { useNow } from './useNow';

const EMPTY_PLACE: Place = { building: null, cabinet: null, floor: null };
const EMPTY_EVENTS: readonly unknown[] = [];

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function categoryLabel(meta: WebPageProps['meta'], code: string | null): string {
  if (!code) return 'Без категории';
  const item = meta.dictionaries.find((entry) => entry.dictionary === 'category' && entry.code === code);
  return item?.label ?? code;
}

function CheckIcon(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
      <path d="M5 12l5 5 9-10" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Экран «Авария и массовость» (дизайн 4.5): авария — точка и текст, не красный фон. */
export function IncidentsPage({ meta, api, trackAction }: WebPageProps): JSX.Element {
  const [tickets, setTickets] = useState<Ticket[]>([]);
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

  const [checks, setChecks] = useState<readonly boolean[]>([]);
  const [incident, setIncident] = useState<{ number: string; size: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const rowsRef = useRef<HTMLDivElement | null>(null);
  const incidentRef = useRef<HTMLDivElement | null>(null);
  useListMotion(rowsRef, tickets.length > 0);

  useEffect(() => {
    if (incident !== null) pulse(incidentRef.current);
  }, [incident]);

  const now = useNow(30_000);
  const selectedTicket = useMemo(
    () => tickets.find((ticket) => ticket.id === selectedId) ?? allTickets.find((ticket) => ticket.id === selectedId) ?? null,
    [tickets, allTickets, selectedId],
  );
  const verdict = useMemo(() => readEmergencyVerdict(analysis), [analysis]);
  const checklist = useMemo(() => verdict?.checklist ?? [], [verdict]);
  const checklistSignature = checklist.join('|');
  const elapsed = useElapsed(detail?.appeal.createdAt ?? selectedTicket?.createdAt ?? null);

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
        const sorted = sortByRecent(emergency.tickets);
        setTickets(sorted);
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

  /* ---------- Место заявок списка (корпус и кабинет — в полях) ---------- */

  useEffect(() => {
    const missing = tickets.filter((ticket) => places[ticket.id] === undefined).slice(0, 40);
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
  }, [tickets, places, api]);

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
      setIncident(null);
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
    setIncident(null);

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

  useEffect(() => {
    setChecks(checklist.map(() => false));
  }, [checklistSignature]);

  /* ---------- Массовость: категория + корпус за окно ---------- */

  const selectedPlace = selectedId === null ? null : (places[selectedId] ?? null);
  const similar = useMemo(() => {
    if (selectedTicket === null) return [];
    return similarTickets(allTickets.length > 0 ? allTickets : tickets, selectedTicket, (id) => places[id], {
      now,
      windowMinutes: MASS_WINDOW_MINUTES,
      includeTarget: true,
    });
  }, [allTickets, tickets, selectedTicket, places, now]);
  const mass = useMemo(
    () => massTimeline(similar, now, { windowMinutes: MASS_WINDOW_MINUTES, threshold: MASS_THRESHOLD }),
    [similar, now],
  );

  const userName = useCallback(
    (id: string): string | null => users.find((item) => item.id === id)?.fullName ?? null,
    [users],
  );
  const timeline = useMemo(() => timelineItems(events, { resolveUser: userName }), [events, userName]);

  const doneCount = checks.filter(Boolean).length;
  const progress = checklist.length === 0 ? 0 : Math.round((doneCount / checklist.length) * 100);
  const assignee = selectedTicket?.assigneeId
    ? (users.find((item) => item.id === selectedTicket.assigneeId) ?? null)
    : null;
  const hasPlace = selectedPlace !== null && selectedPlace.building !== null;
  const quote = detail?.appeal.originalText ?? '';
  const quoteParts = quoteSegments(
    quote,
    (verdict?.signs ?? []).map((sign) => sign.quote),
  );

  const toggleCheck = (index: number): void => {
    setChecks((previous) => previous.map((value, position) => (position === index ? !value : value)));
    trackAction?.('select');
  };

  const declareIncident = (): void => {
    if (selectedTicket === null) return;
    const number = incidentNumber(selectedTicket.number);
    setIncident({ number, size: similar.length });
    setToast(`Инцидент ${number}: сообщение отправлено всем заявителям (${similar.length}).`);
    trackAction?.('click');
  };

  return (
    <div className="er-page">
      <header className="er-head" data-reveal>
        <div>
          <h1 className="er-title">Аварии и массовость</h1>
          <p className="er-lead">Аварийные заявки сверху. Проверьте признаки и регламент, при необходимости объявите массовый сбой.</p>
        </div>
        <div className="er-head__actions">
          <Badge tone={tickets.length > 0 ? 'danger' : 'ok'} dot={tickets.length > 0}>
            Аварий: {tickets.length}
          </Badge>
          <Button
            variant="secondary"
            size="sm"
            loading={loading}
            onClick={() => {
              setRefreshToken((value) => value + 1);
              trackAction?.('click');
            }}
          >
            Обновить
          </Button>
        </div>
      </header>

      {error !== null && (
        <Card tone="danger">
          <h2>API не отвечает</h2>
          <p className="ugra-muted">{error}</p>
          <Button variant="secondary" size="sm" onClick={() => setRefreshToken((value) => value + 1)}>
            Повторить
          </Button>
        </Card>
      )}

      {loading && tickets.length === 0 && (
        <Card>
          <p className="ugra-muted">Загружаем аварийные заявки…</p>
        </Card>
      )}

      {!loading && error === null && tickets.length === 0 && (
        <EmptyState
          title="Аварий нет — это хорошо"
          hint="Аварийных заявок сейчас нет. Экран обновится сам, когда ИИ найдёт признаки аварии в новом обращении."
          icon="✓"
        />
      )}

      {tickets.length > 0 && (
        <div className="er-layout">
          <Card className="er-list" padded={false} as="section">
            <div className="er-list__head">
              <h2 className="er-card__title">Аварийные заявки</h2>
              <span className="er-list__count">{tickets.length}</span>
            </div>
            <div className="er-list__rows" ref={rowsRef}>
              {tickets.map((ticket) => {
                const place = places[ticket.id];
                const active = ticket.id === selectedId;
                return (
                  <button
                    type="button"
                    key={ticket.id}
                    className={active ? 'er-row er-row--on' : 'er-row'}
                    aria-current={active ? 'true' : undefined}
                    onClick={() => {
                      setSelectedId(ticket.id);
                      trackAction?.('select');
                    }}
                  >
                    <span className="er-row__num">№ {ticket.number}</span>
                    <span className="er-row__age">{incidentTimer(ticket.createdAt, now).age}</span>
                    <span className="er-row__foot">
                      <span className="er-row__meta">
                        <span>{eventTime(ticket.createdAt) ?? '—'}</span>
                        <span aria-hidden="true">·</span>
                        <span>{place ? placeLabel(place) : 'загружаем…'}</span>
                      </span>
                      <Badge tone={ticketStatusTone(ticket.status)}>{formatTicketStatus(ticket.status)}</Badge>
                    </span>
                  </button>
                );
              })}
            </div>
          </Card>

          <div className="er-detail">
            {selectedTicket === null && (
              <Card>
                <p className="ugra-muted">Выберите аварийную заявку слева.</p>
              </Card>
            )}

            {selectedTicket !== null && (
              <>
                <Card className="er-hero">
                  <div className="er-hero__top">
                    <div className="er-hero__main">
                      <div className="er-eyebrow">
                        <span className="er-beat" aria-hidden="true" />
                        {emergencyLevelLabel(
                          verdict !== null && verdict.level !== 'none'
                            ? verdict.level
                            : selectedTicket.isEmergency
                              ? 'suspected'
                              : 'none',
                        )}{' '}
                        · № {selectedTicket.number} · {channelLabel(detail?.appeal.channel)}
                      </div>
                      <h2 className="er-hero__title">
                        {categoryLabel(meta, selectedTicket.category)} · {placeLabel(selectedPlace)}
                      </h2>
                      {detail !== null && quote !== '' && (
                        <p className="er-quote">
                          «
                          {quoteParts.map((part, index) =>
                            part.strong ? <strong key={index}>{part.text}</strong> : <span key={index}>{part.text}</span>,
                          )}
                          »
                        </p>
                      )}
                      {detail === null && detailError === null && <p className="ugra-muted">Загружаем обращение…</p>}
                      {detailError !== null && (
                        <p className="er-note" role="alert">
                          Не удалось загрузить обращение: {detailError}
                        </p>
                      )}
                    </div>
                    <div className="er-timer">
                      <div className="er-timer__label">С момента обращения</div>
                      <div className="er-timer__value">{formatTimer(elapsed)}</div>
                    </div>
                  </div>

                  <div className="er-meta">
                    <DetailRow
                      layout="stack"
                      label="Почему авария"
                      value={emergencyReason(verdict)}
                      tone={verdict !== null && verdict.level !== 'none' ? 'danger' : 'default'}
                    />
                    <div className="er-meta__confidence">
                      <ConfidenceBar compact value={verdict?.confidence ?? 0} label="Уверенность ИИ" />
                    </div>
                    <DetailRow
                      layout="stack"
                      label="Ответственный"
                      value={assignee ? assignee.fullName : 'не назначен'}
                      hint={assignee ? assignee.position : 'назначьте в карточке заявки'}
                    />
                    <DetailRow
                      layout="stack"
                      label="Статус"
                      value={
                        <Badge tone={ticketStatusTone(selectedTicket.status)}>
                          {formatTicketStatus(selectedTicket.status)}
                        </Badge>
                      }
                    />
                  </div>

                  {analysisMissing && (
                    <p className="er-note">Разбор ИИ недоступен: признаки и чек-лист появятся позже.</p>
                  )}
                  {verdict !== null && verdict.level === 'none' && (
                    <p className="er-note">
                      В разборе признаков аварии нет, но заявка помечена аварийной — проверьте текст и регламент.
                    </p>
                  )}
                </Card>

                <div className="er-cards">
                  {/* Регламент чек-листом: отметки локальные, сервер их пока не хранит. */}
                  <Card className="er-card">
                    <div className="er-card__head">
                      <h2 className="er-card__title">Регламент</h2>
                      <span className="er-card__counter">
                        {doneCount} из {checklist.length}
                      </span>
                    </div>
                    <div
                      className="er-progress"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={checklist.length}
                      aria-valuenow={doneCount}
                      aria-label="Пройдено пунктов регламента"
                    >
                      <span className="er-progress__fill" style={{ width: `${progress}%` }} />
                    </div>

                    {analysisLoading && <p className="ugra-muted">Загружаем регламент…</p>}
                    {!analysisLoading && checklist.length === 0 && (
                      <p className="ugra-muted">
                        Регламент не задан: в разборе нет чек-листа. Действуйте по инструкции дежурного.
                      </p>
                    )}
                    {checklist.map((step, index) => {
                      const on = checks[index] === true;
                      return (
                        <button
                          type="button"
                          key={`${index}-${step}`}
                          className={on ? 'er-check er-check--on' : 'er-check'}
                          aria-pressed={on}
                          onClick={() => toggleCheck(index)}
                        >
                          <span className="er-check__box" aria-hidden="true">
                            {on && <CheckIcon />}
                          </span>
                          <span className="er-check__text">{step}</span>
                        </button>
                      );
                    })}
                  </Card>

                  <Card className="er-card">
                    <h2 className="er-card__title">Хронология</h2>
                    {eventsBlocked ? (
                      <p className="er-note">
                        События заявки недоступны: маршрут вернул ошибку или нет права смотреть журнал.
                      </p>
                    ) : (
                      <Timeline items={timeline} empty="Событий пока нет" />
                    )}
                  </Card>

                  <Card className="er-card er-mass">
                    <div className="er-card__head">
                      <h2 className="er-card__title">Похоже на массовый сбой</h2>
                      <Badge tone={mass.thresholdMet ? 'danger' : 'neutral'}>
                        {mass.thresholdMet ? 'Порог пройден' : 'Порог не достигнут'}
                      </Badge>
                    </div>
                    <div className="er-mass__subject">
                      {categoryLabel(meta, selectedTicket.category)} · {placeLabel(selectedPlace)}
                    </div>

                    {hasPlace ? (
                      <>
                        <div className="er-mass__count">
                          <span className="er-mass__num">{mass.total}</span>
                          <span className="er-mass__caption">
                            похожих обращений за {MASS_WINDOW_MINUTES} мин, включая эту заявку
                          </span>
                        </div>

                        <div
                          className="er-bars"
                          role="img"
                          aria-label={`Похожие обращения по минутам: ${mass.total} за ${MASS_WINDOW_MINUTES} минут, порог ${MASS_THRESHOLD}`}
                        >
                          <span
                            className="er-bars__threshold"
                            style={{ bottom: `${Math.min(94, Math.round((mass.threshold / mass.max) * 100))}%` }}
                            aria-hidden="true"
                          >
                            <span>порог</span>
                          </span>
                          {mass.points.map((point) => {
                            const tone = point.count === 0 ? 'empty' : mass.thresholdMet ? 'hot' : 'on';
                            const height = Math.max(2, Math.round((point.count / mass.max) * 100));
                            return (
                              <span
                                key={point.key}
                                className={`er-bar er-bar--${tone}`}
                                style={{ height: `${height}%` }}
                                title={`${point.label} — ${point.count}`}
                              />
                            );
                          })}
                        </div>
                        <div className="er-bars__axis" aria-hidden="true">
                          <span>{mass.points[0]?.label ?? '—'}</span>
                          <span>сейчас</span>
                        </div>
                        <p className="er-note">
                          Порог — {MASS_THRESHOLD} похожих за {MASS_WINDOW_MINUTES} минут в одном корпусе.
                        </p>
                      </>
                    ) : (
                      <p className="er-note">
                        Недостаточно данных: у заявки не указан корпус или категория — сравнивать не с чем.
                      </p>
                    )}

                    {incident === null ? (
                      <>
                        <Button variant="primary" block onClick={declareIncident} disabled={!hasPlace}>
                          Объявить массовым инцидентом
                        </Button>
                      </>
                    ) : (
                      <div className="er-incident" ref={incidentRef}>
                        <div className="er-incident__title">Инцидент № {incident.number}</div>
                        <p className="er-incident__text">
                          {incident.size} заявителей получили одно сообщение. Новые похожие обращения прикрепляются
                          сами.
                        </p>
                      </div>
                    )}
                  </Card>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <Toast message={toast} tone="ok" onClose={() => setToast(null)} />
    </div>
  );
}
