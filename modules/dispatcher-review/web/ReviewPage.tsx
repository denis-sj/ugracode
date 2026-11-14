import './review.css';
import type { AssigneeCandidate, TicketResponse, User, UsersResponse } from '@ugra/contracts';
import { hasPermission } from '@ugra/contracts';
import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActionCounterPill,
  Badge,
  Button,
  Card,
  DetailRow,
  EmptyState,
  Modal,
  PriorityMark,
  ProgressScale,
  StepBlock,
  TICKET_STAGES,
  Toast,
  formatDateTime,
  formatDue,
  ticketStage,
  useActionCounter,
} from '@ugra/ui';
import type { WebPageProps } from '@ugra/ui';
import {
  analysisEmergency,
  candidatePercent,
  locationFromTicket,
  fieldDisplayValue,
  filledFieldCount,
  formatLocation,
  groupTicketFields,
  highlightQuotes,
  journalRows,
  PRIORITY_LABELS,
  priorityReason,
  replyTemplate,
  reviewFieldKeys,
  reviewTicketId,
  STATUS_LABELS,
  statusTone,
  ticketTitleFromFields,
  traceSteps,
} from './format';
import { DeadlineChips, Kbd } from './parts';
import { ReviewFields } from './ReviewFields';
import { hasTicketWidget } from './ticket-slots';
import { TicketSlot, useTicketWidgets } from './TicketSlot';
import { useNow } from './useNow';

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

function candidateName(users: readonly User[], id: string): string {
  return users.find((user) => user.id === id)?.fullName ?? id;
}

function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** Проверка заявки по шагам (4.4): обращение → поля → исполнитель → ответ. */
export function ReviewPage({ user, meta, api, navigate, query, trackAction }: WebPageProps): JSX.Element {
  const ticketId = reviewTicketId(query);
  const now = useNow(30_000);
  const actions = useActionCounter();

  const [detail, setDetail] = useState<TicketResponse | null>(null);
  const [events, setEvents] = useState<unknown[]>([]);
  const [analysis, setAnalysis] = useState<Record<string, unknown> | null>(null);
  const [candidates, setCandidates] = useState<AssigneeCandidate[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assigneeId, setAssigneeId] = useState('');
  const [openStep, setOpenStep] = useState(1);
  const [maxStep, setMaxStep] = useState(1);
  const [reply, setReply] = useState('');
  const [replyTouched, setReplyTouched] = useState(false);
  const [assigned, setAssigned] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const canEdit = hasPermission(user.role, 'tickets.edit');
  const canConfirm = hasPermission(user.role, 'tickets.confirm');

  /* Слоты карточки заявки: виджеты модулей из реестра, страница работает и без них. */
  const widgets = useTicketWidgets();
  const hasBanner = hasTicketWidget(widgets, 'ticket.banner', user.role);
  const hasFooter = hasTicketWidget(widgets, 'ticket.footer', user.role);
  const slotContext = useMemo(
    () => ({ ticketId: ticketId ?? '', api, user, trackAction }),
    [api, ticketId, trackAction, user],
  );

  const readTicket = useCallback(async (): Promise<void> => {
    if (!ticketId) return;
    const [nextDetail, nextEvents, nextAnalysis] = await Promise.all([
      api.get<TicketResponse>(`/api/tickets/${ticketId}`),
      api.get<{ events: unknown[] }>(`/api/tickets/${ticketId}/events`).catch(() => ({ events: [] })),
      api.get<{ analysis: Record<string, unknown> }>(`/api/tickets/${ticketId}/analysis`).catch(() => null),
    ]);
    setDetail(nextDetail);
    setEvents(nextEvents.events);
    setAnalysis(nextAnalysis ? nextAnalysis.analysis : null);
  }, [api, ticketId]);

  useEffect(() => {
    if (!ticketId) {
      setLoading(false);
      return undefined;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    setAssigned(false);
    setOpenStep(1);
    setMaxStep(1);
    setReplyTouched(false);
    Promise.all([
      api.get<TicketResponse>(`/api/tickets/${ticketId}`),
      api.get<{ events: unknown[] }>(`/api/tickets/${ticketId}/events`).catch(() => ({ events: [] })),
      api.get<{ analysis: Record<string, unknown> }>(`/api/tickets/${ticketId}/analysis`).catch(() => null),
      api.get<UsersResponse>('/api/users').catch(() => ({ users: [] as User[] })),
      api
        .get<{ candidates: AssigneeCandidate[] }>(`/api/m/routing/candidates/${ticketId}`)
        .catch(() => ({ candidates: [] as AssigneeCandidate[] })),
    ])
      .then(([nextDetail, nextEvents, nextAnalysis, nextUsers, nextCandidates]) => {
        if (!alive) return;
        setDetail(nextDetail);
        setEvents(nextEvents.events);
        setAnalysis(nextAnalysis ? nextAnalysis.analysis : null);
        setUsers(nextUsers.users);
        setCandidates(nextCandidates.candidates);
        setAssigneeId(nextDetail.ticket.assigneeId ?? nextCandidates.candidates[0]?.userId ?? '');
      })
      .catch((cause: unknown) => {
        if (alive) setError(cause instanceof Error ? cause.message : 'Не удалось открыть заявку');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [api, ticketId]);

  const assigneeName = useCallback(
    (id: string): string | null => users.find((candidate) => candidate.id === id)?.fullName ?? null,
    [users],
  );

  useEffect(() => {
    if (!detail || replyTouched) return;
    setReply(
      replyTemplate(
        detail.ticket,
        assigneeId ? assigneeName(assigneeId) : null,
        detail.ticket.slaDueAt ? formatDue(detail.ticket.slaDueAt) : null,
      ),
    );
  }, [assigneeId, assigneeName, detail, replyTouched]);

  const saveField = useCallback(
    async (key: string, value: string | null): Promise<boolean> => {
      if (!ticketId) return false;
      try {
        await api.patch(`/api/tickets/${ticketId}/fields/${encodeURIComponent(key)}`, { value });
        await readTicket();
        trackAction?.('system');
        return true;
      } catch (cause) {
        const text = cause instanceof Error ? cause.message : 'Не удалось сохранить поле';
        setToast(text);
        return false;
      }
    },
    [api, readTicket, ticketId, trackAction],
  );

  const confirmTicket = useCallback(async (): Promise<void> => {
    if (!detail || detail.ticket.status !== 'in_review') {
      setToast('Заявка уже не на проверке.');
      return;
    }
    if (!assigneeId) {
      setToast('Выберите исполнителя.');
      return;
    }
    setConfirming(true);
    setToast(null);
    try {
      await api.post(`/api/tickets/${ticketId}/confirm`, { assigneeId });
      trackAction?.('system');
      setAssigned(true);
      void readTicket().catch(() => undefined);
    } catch (cause) {
      setToast(cause instanceof Error ? cause.message : 'Не удалось подтвердить заявку');
    } finally {
      setConfirming(false);
    }
  }, [api, assigneeId, detail, readTicket, ticketId, trackAction]);

  useEffect(() => {
    if (assigned) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Enter' || event.defaultPrevented) return;
      if (isTypingTarget(event.target) || (event.target instanceof HTMLElement && event.target.closest('button, a'))) {
        return;
      }
      if (!detail || detail.ticket.status !== 'in_review' || !canConfirm) return;
      event.preventDefault();
      void confirmTicket();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [assigned, canConfirm, confirmTicket, detail]);

  const groups = useMemo(() => (detail ? groupTicketFields(detail.fields, meta.fields) : []), [detail, meta.fields]);
  const reviewCount = useMemo(() => reviewFieldKeys(groups).length, [groups]);
  const fieldCount = useMemo(() => filledFieldCount(groups), [groups]);
  const trace = useMemo(() => traceSteps(analysis, detail?.fields ?? []), [analysis, detail]);
  const emergency = useMemo(() => analysisEmergency(analysis), [analysis]);
  const title = useMemo(
    () =>
      detail
        ? ticketTitleFromFields(detail.fields, (key, value) =>
            key === 'category' ? fieldDisplayValue(meta, key, value) ?? value : value,
          )
        : 'Заявка',
    [detail, meta],
  );
  const place = useMemo(
    () =>
      detail
        ? formatLocation(locationFromTicket(detail.ticket, detail.fields), (code) => {
            return (
              meta.dictionaries.find((entry) => entry.dictionary === 'building' && entry.code === code)?.label ?? code
            );
          })
        : '',
    [detail, meta.dictionaries],
  );
  const category = detail ? fieldDisplayValue(meta, 'category', detail.ticket.category) : null;
  const segments = useMemo(() => {
    if (!detail) return [];
    const quotes = detail.fields.map((field) => field.quote?.text).filter((quote): quote is string => Boolean(quote));
    return highlightQuotes(detail.appeal.originalText, quotes);
  }, [detail]);

  const corrections = useMemo(() => {
    const fieldLabels = new Map(meta.fields.map((def) => [def.key, def.label]));
    return journalRows(events, {
      fieldLabel: (key) => fieldLabels.get(key) ?? key,
      formatValue: (key, value) => fieldDisplayValue(meta, key, value),
      actorName: (id) => (id ? assigneeName(id) : null),
    })
      .filter((row) => row.type === 'ticket.field.corrected')
      .slice(0, 3);
  }, [assigneeName, events, meta]);

  const topCandidate = candidates.find((candidate) => candidate.userId === assigneeId) ?? candidates[0];
  const bestScore = candidates[0]?.score ?? 1;
  const go = (step: number): void => {
    setOpenStep(step);
    setMaxStep((current) => Math.max(current, step));
    trackAction?.('navigate');
  };
  const done = (step: number): boolean => maxStep > step || (step === 4 && assigned);

  if (!ticketId) {
    return (
      <div className="review-page">
        <EmptyState title="Заявка не выбрана" hint="Вернитесь в очередь и нажмите «Открыть» у нужной заявки.">
          <Button variant="primary" size="sm" onClick={() => navigate('/queue')}>
            К очереди
          </Button>
        </EmptyState>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="review-page">
        <Card>
          <div className="review-skeleton" aria-label="Загружаем заявку">
            {[0, 1, 2].map((index) => (
              <span className="review-skeleton__line" key={index} />
            ))}
          </div>
        </Card>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="review-page">
        <Card tone="danger">
          <h2>Не удалось открыть заявку</h2>
          <p className="ugra-muted">{error ?? 'Заявка не найдена'}</p>
          <div className="review-actions-inline">
            <Button variant="secondary" size="sm" onClick={() => void readTicket().catch(() => undefined)}>
              Повторить
            </Button>
            <Button variant="ghost" size="sm" onClick={() => navigate('/queue')}>
              К очереди
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const { ticket } = detail;
  const hasAsked = trace.some((step) => step.stage === 'asked');
  const hasYou = trace.some((step) => step.stage === 'you');
  const reviewSuffix = reviewCount === 1 ? '1 ждёт вас' : `${reviewCount} ждут вас`;
  const stepSummary = [
    `${trace.length} ${plural(trace.length, 'шаг', 'шага', 'шагов')} следа`,
    `${fieldCount} ${plural(fieldCount, 'поле', 'поля', 'полей')}, ${reviewSuffix}`,
    topCandidate ? `${candidateName(users, topCandidate.userId)} · ${candidatePercent(topCandidate.score, bestScore)}%` : 'выберите',
    'Черновик готов',
  ];

  return (
    <div className="review-page">
      <button type="button" className="review-back" onClick={() => navigate('/queue')}>
        ← Очередь
      </button>

      <header className="review-head" data-reveal>
        <div className="review-head__meta">
          № {ticket.number} · {detail.appeal.channel} · {formatDateTime(ticket.createdAt)}
        </div>
        <div className="review-head__row">
          <h1 className="review-title">{title}</h1>
          <div className="review-head__badges">
            <Badge tone={statusTone(ticket.status)} dot={ticket.status === 'in_review'}>
              {STATUS_LABELS[ticket.status]}
            </Badge>
            <PriorityMark priority={ticket.priority} isEmergency={ticket.isEmergency} withLabel />
          </div>
        </div>
        <div className="review-head__place">{place}</div>
      </header>

      {hasBanner ? (
        <TicketSlot name="ticket.banner" widgets={widgets} context={slotContext} />
      ) : (
        emergency && (
          <div className="review-emergency" role="alert">
            <span className="review-emergency__dot" aria-hidden="true" />
            <div>
              <b>
                {emergency.level === 'confirmed' ? 'Авария подтверждена' : 'Возможна авария'} ·{' '}
                {Math.round(emergency.confidence * 100)}%
              </b>
              {emergency.signs.length > 0 && (
                <span className="review-emergency__signs">Признаки: {emergency.signs.map((sign) => `«${sign}»`).join(', ')}</span>
              )}
            </div>
          </div>
        )
      )}

      <div className="review-layout">
        <div className="review-steps">
          <StepBlock
            index={1}
            title="Обращение"
            open={openStep === 1}
            done={done(1)}
            summary={stepSummary[0]}
            onToggle={() => go(1)}
            footer={
              <Button variant="primary" size="sm" onClick={() => go(2)}>
                Понятно, к полям
              </Button>
            }
          >
            <div className="review-appeal">
              {segments.map((segment, index) =>
                segment.quote ? <mark key={index}>{segment.text}</mark> : <span key={index}>{segment.text}</span>,
              )}
            </div>

            <div className="review-flow" aria-hidden="true">
              {['Нашёл', 'Сверил', 'Спросил', 'Вам'].map((label) => (
                <span key={label}>{label}</span>
              ))}
            </div>

            {trace.length === 0 ? (
              <p className="ugra-muted">След разбора пуст — проверьте поля вручную.</p>
            ) : (
              <ol className="review-trace">
                {trace.map((step) => (
                  <li className={`review-trace__item review-trace__item--${step.tone}`} key={step.id}>
                    <span className="review-trace__stage">{step.stageLabel}</span>
                    <span className="review-trace__text">{step.text}</span>
                  </li>
                ))}
                {!hasAsked && (
                  <li className="review-trace__item review-trace__item--info">
                    <span className="review-trace__stage">Спросил</span>
                    <span className="review-trace__text">Уточнений не потребовалось</span>
                  </li>
                )}
                {!hasYou && (
                  <li className="review-trace__item review-trace__item--warn">
                    <span className="review-trace__stage">Вам</span>
                    <span className="review-trace__text">
                      {reviewCount > 0
                        ? `Проверить ${reviewCount} ${plural(reviewCount, 'поле', 'поля', 'полей')}`
                        : 'Проверить поля и назначить'}
                    </span>
                  </li>
                )}
              </ol>
            )}

            <p className="review-why">
              <b>Почему такой приоритет: </b>
              {priorityReason(ticket, detail.fields, (key, value) => fieldDisplayValue(meta, key, value) ?? value)}
            </p>
          </StepBlock>

          <StepBlock
            index={2}
            title="Поля заявки"
            open={openStep === 2}
            done={done(2)}
            summary={stepSummary[1]}
            onToggle={() => go(2)}
            footer={
              <Button variant="primary" size="sm" onClick={() => go(3)}>
                К исполнителю
              </Button>
            }
          >
            <ReviewFields
              fields={detail.fields}
              meta={meta}
              canEdit={canEdit}
              onSave={saveField}
              trackAction={trackAction}
            />
            {corrections.length > 0 && (
              <div className="review-journal">
                <h4 className="review-group__title">Последние правки</h4>
                <ul>
                  {corrections.map((row) => {
                    const before = row.diff?.before.map((segment) => segment.text).join('') ?? '';
                    const after = row.diff?.after.map((segment) => segment.text).join('') ?? '';
                    return (
                      <li key={row.id}>
                        <b>{row.fieldLabel ?? row.title}</b>
                        {row.diff?.changed ? (
                          <span>
                            : ИИ «{before || '—'}» → вы «{after || '—'}»
                          </span>
                        ) : (
                          <span>{row.description ? `: ${row.description}` : ''}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </StepBlock>

          <StepBlock
            index={3}
            title="Исполнитель"
            open={openStep === 3}
            done={done(3)}
            summary={stepSummary[2]}
            onToggle={() => go(3)}
            footer={
              <Button variant="primary" size="sm" onClick={() => go(4)}>
                К ответу заявителю
              </Button>
            }
          >
            <div className="review-candidates">
              <div className="review-candidates__list">
                {candidates.slice(0, 3).map((candidate) => {
                  const active = candidate.userId === (topCandidate?.userId ?? '');
                  const percent = candidatePercent(candidate.score, bestScore);
                  return (
                    <button
                      type="button"
                      key={candidate.userId}
                      className={`review-candidate${active ? ' review-candidate--on' : ''}`}
                      aria-pressed={active}
                      onClick={() => {
                        setAssigneeId(candidate.userId);
                        trackAction?.('select');
                      }}
                    >
                      <span className="review-candidate__row">
                        <b>{candidateName(users, candidate.userId)}</b>
                        <span>{percent}%</span>
                      </span>
                      <span className="review-candidate__bar" aria-hidden="true">
                        <span style={{ width: `${percent}%` }} />
                      </span>
                    </button>
                  );
                })}
                {candidates.length === 0 && (
                  <label className="review-candidate-empty">
                    <span>Кандидатов нет — выберите инженера вручную</span>
                    <select
                      className="review-editor__control"
                      value={assigneeId}
                      onChange={(event) => setAssigneeId(event.target.value)}
                    >
                      <option value="">Выберите инженера…</option>
                      {users
                        .filter((candidate) => candidate.role === 'engineer')
                        .map((engineer) => (
                          <option value={engineer.id} key={engineer.id}>
                            {engineer.fullName}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
              </div>

              {topCandidate && (
                <div className="review-candidate__why">
                  <span className="review-group__title">Почему ИИ предлагает</span>
                  <b className="review-candidate__name">
                    {candidateName(users, topCandidate.userId)}
                    <span>{candidatePercent(topCandidate.score, bestScore)}%</span>
                  </b>
                  <ul>
                    {topCandidate.reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </StepBlock>

          <StepBlock
            index={4}
            title="Ответ заявителю"
            open={openStep === 4}
            done={done(4)}
            summary={stepSummary[3]}
            onToggle={() => go(4)}
            footer={
              <>
                <Button
                  variant="primary"
                  loading={confirming}
                  disabled={!canConfirm || ticket.status !== 'in_review' || !assigneeId}
                  onClick={() => void confirmTicket()}
                  title={assigneeId ? 'Подтвердить и назначить (Enter)' : 'Сначала выберите исполнителя'}
                >
                  Подтвердить и назначить <Kbd>Enter</Kbd>
                </Button>
              </>
            }
          >
            {hasFooter ? (
              <TicketSlot name="ticket.footer" widgets={widgets} context={slotContext} />
            ) : (
              <label className="review-reply">
                <span className="review-reply__caption">Черновик ответа — можно поправить</span>
                <textarea
                  className="review-reply__input"
                  rows={4}
                  value={reply}
                  onChange={(event) => {
                    setReply(event.target.value);
                    setReplyTouched(true);
                    trackAction?.('input');
                  }}
                />
              </label>
            )}
          </StepBlock>
        </div>

        <aside className="review-summary">
          <Card>
            <span className="review-summary__eyebrow">Итог заявки</span>
            <ProgressScale className="review-summary__scale" stage={ticketStage(ticket.status)} labels={TICKET_STAGES} showLabels />
            <div className="review-summary__rows">
              <DetailRow label="Категория" value={category ?? '—'} />
              <DetailRow label="Место" value={place} />
              <DetailRow label="Подразделение" value={ticket.departmentId ?? '—'} />
              <DetailRow label="Приоритет" value={ticket.priority ? PRIORITY_LABELS[ticket.priority] : '—'} />
              <DetailRow label="Исполнитель" value={assigneeId ? assigneeName(assigneeId) ?? assigneeId : 'не выбран'} />
              <DetailRow label="Проверить полей" value={reviewCount} />
            </div>
            <div className="review-summary__actions">
              <ActionCounterPill count={actions.count} />
            </div>
          </Card>
          <Card>
            <span className="review-group__title">Сроки по регламенту</span>
            <DeadlineChips ticket={ticket} now={now} />
          </Card>
        </aside>
      </div>

      <Modal
        open={assigned}
        title="Заявка назначена"
        tone="ok"
        onClose={() => setAssigned(false)}
        footer={
          <>
            <Button variant="primary" onClick={() => navigate('/queue')}>
              Следующая заявка
            </Button>
            <Button variant="secondary" onClick={() => setAssigned(false)}>
              Остаться
            </Button>
          </>
        }
      >
        <p>
          {assigneeId ? `${assigneeName(assigneeId) ?? 'Инженер'} получил задачу.` : 'Инженер получил задачу.'} Правки
          записаны в журнал.
        </p>
      </Modal>

      <Toast message={toast} onClose={() => setToast(null)} />
    </div>
  );
}
