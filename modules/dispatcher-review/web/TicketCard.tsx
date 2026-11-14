import './review.css';
import type { FieldDef, MetaResponse, TicketField, TicketResponse, User, UsersResponse } from '@ugra/contracts';
import { hasPermission } from '@ugra/contracts';
import type { JSX, KeyboardEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Card, FieldRow, formatDateTime } from '@ugra/ui';
import type { ApiClient, BadgeTone, WebPageProps } from '@ugra/ui';
import {
  filterJournal,
  groupTicketFields,
  highlightQuotes,
  JOURNAL_ALL,
  journalRows,
  journalTypes,
  lastReturn,
  priorityReason,
  reviewFieldKeys,
  STATUS_LABELS,
  statusTone,
} from './format';
import type { JournalRow } from './format';
import { DeadlineChips, Kbd, PriorityBars } from './parts';
import { useNow } from './useNow';

type MessageTone = 'ok' | 'error';
type CardTab = 'fields' | 'journal';

/** Как часто перечитываем карточку и журнал: возврат инженером и правки видны без F5. */
const CARD_REFRESH_MS = 15_000;

export interface TicketCardProps {
  api: ApiClient;
  meta: MetaResponse;
  user: WebPageProps['user'];
  ticketId: string;
  onClose: () => void;
  /** Сообщает очереди, что заявка изменилась (для подсветки строки). */
  onChanged: (ticketId?: string) => void;
  trackAction?: WebPageProps['trackAction'];
}

function dictionaryLabel(meta: MetaResponse, def: FieldDef, value: string | null): string | null {
  if (value === null) return null;
  if (def.type === 'dictionary' && def.dictionary) {
    const item = meta.dictionaries.find((entry) => entry.dictionary === def.dictionary && entry.code === value);
    return item?.label ?? value;
  }
  return value;
}

function resolveValue(meta: MetaResponse, key: string, value: string | null): string | null {
  if (value === null) return null;
  const def = meta.fields.find((entry) => entry.key === key);
  return def ? dictionaryLabel(meta, def, value) : value;
}

function dictionaryOptions(meta: MetaResponse, def: FieldDef | undefined): Array<{ code: string; label: string }> {
  if (!def || def.type !== 'dictionary' || !def.dictionary) return [];
  return meta.dictionaries
    .filter((entry) => entry.dictionary === def.dictionary)
    .map((entry) => ({ code: entry.code, label: entry.label }));
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  // Список исполнителя не мешает Enter: выбран инженер — подтверждаем.
  return ['INPUT', 'TEXTAREA'].includes(target.tagName);
}

/** Строка журнала: «ИИ предложил → человек исправил» с подсветкой отличий. */
function JournalEntry({ row }: { row: JournalRow }): JSX.Element {
  const diff = row.diff;
  return (
    <li className={`dr-journal__row dr-journal__row--${row.tone}`}>
      <div className="dr-journal__head">
        <span className="dr-journal__title">{row.fieldLabel ?? row.title}</span>
        <Badge tone={row.tone as BadgeTone}>{row.type}</Badge>
        {row.at && <span className="dr-journal__time">{formatDateTime(row.at)}</span>}
        <span className="dr-journal__author" title={`Тип автора: ${row.actorKind}`}>
          {row.author}
        </span>
      </div>

      {diff && diff.changed && (
        <div className="dr-journal__diff">
          <span className="dr-journal__side">
            <span className="dr-journal__caption">ИИ предложил</span>
            {diff.before.length === 0 ? (
              <span className="dr-journal__empty">— не предлагал</span>
            ) : (
              diff.before.map((segment, index) =>
                segment.changed ? (
                  <mark key={index} className="dr-journal__mark dr-journal__mark--ai">
                    {segment.text}
                  </mark>
                ) : (
                  <span key={index}>{segment.text}</span>
                ),
              )
            )}
          </span>
          <span className="dr-journal__arrow" aria-hidden="true">
            →
          </span>
          <span className="dr-journal__side">
            <span className="dr-journal__caption">человек исправил</span>
            {diff.after.length === 0 ? (
              <span className="dr-journal__empty">— очистил</span>
            ) : (
              diff.after.map((segment, index) =>
                segment.changed ? (
                  <mark key={index} className="dr-journal__mark dr-journal__mark--human">
                    {segment.text}
                  </mark>
                ) : (
                  <span key={index}>{segment.text}</span>
                ),
              )
            )}
          </span>
        </div>
      )}

      {row.description && <div className="dr-journal__desc">{row.description}</div>}
      {row.reason && <div className="dr-journal__reason">Причина: {row.reason}</div>}
    </li>
  );
}

/** Карточка заявки: поля с проверкой, сроки, подтверждение и журнал «ИИ → человек». */
export function TicketCard({ api, meta, user, ticketId, onClose, onChanged, trackAction }: TicketCardProps): JSX.Element {
  const [detail, setDetail] = useState<TicketResponse | null>(null);
  const [events, setEvents] = useState<unknown[]>([]);
  const [engineers, setEngineers] = useState<User[]>([]);
  const [people, setPeople] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<CardTab>('fields');
  const [journalType, setJournalType] = useState<string>(JOURNAL_ALL);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState('');
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [assigneeId, setAssigneeId] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState<{ text: string; tone: MessageTone } | null>(null);
  const [retry, setRetry] = useState<{ label: string; run: () => void } | null>(null);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const now = useNow(30_000);

  const canEdit = hasPermission(user.role, 'tickets.edit');
  const canConfirm = hasPermission(user.role, 'tickets.confirm');

  const fieldDefs = useMemo(() => new Map(meta.fields.map((def) => [def.key, def])), [meta.fields]);
  const engineerName = useCallback(
    (id: string | null): string =>
      id ? (engineers.find((candidate) => candidate.id === id)?.fullName ?? id) : 'не назначен',
    [engineers],
  );

  const readAll = useCallback(async (): Promise<void> => {
    const [nextDetail, nextEvents] = await Promise.all([
      api.get<TicketResponse>(`/api/tickets/${ticketId}`),
      api.get<{ events: unknown[] }>(`/api/tickets/${ticketId}/events`).catch(() => ({ events: [] })),
    ]);
    setDetail(nextDetail);
    setEvents(nextEvents.events);
  }, [api, ticketId]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setDetail(null);
    setEditingKey(null);
    setNote(null);
    setRetry(null);
    setTab('fields');
    setJournalType(JOURNAL_ALL);

    Promise.all([
      api.get<TicketResponse>(`/api/tickets/${ticketId}`),
      api.get<{ events: unknown[] }>(`/api/tickets/${ticketId}/events`).catch(() => ({ events: [] })),
      api.get<UsersResponse>('/api/users').catch(() => ({ users: [] as User[] })),
    ])
      .then(([nextDetail, nextEvents, users]) => {
        if (!alive) return;
        setDetail(nextDetail);
        setEvents(nextEvents.events);
        setPeople(users.users);
        setEngineers(users.users.filter((candidate) => candidate.role === 'engineer'));
        setAssigneeId(nextDetail.ticket.assigneeId ?? '');
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

  useEffect(() => {
    rootRef.current?.focus();
  }, [ticketId, loading]);

  useEffect(() => {
    const onEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onEscape);
    return () => document.removeEventListener('keydown', onEscape);
  }, [onClose]);

  useEffect(() => {
    if (!detail) return undefined;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      // тихое обновление: ошибку не показываем, следующий тик попробует снова
      void readAll().catch(() => undefined);
    }, CARD_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [detail, readAll]);

  const groups = useMemo(() => (detail ? groupTicketFields(detail.fields, meta.fields) : []), [detail, meta.fields]);

  const segments = useMemo(() => {
    if (!detail) return [];
    const quotes = detail.fields.map((field) => field.quote?.text).filter((quote): quote is string => Boolean(quote));
    return highlightQuotes(detail.appeal.originalText, quotes);
  }, [detail]);

  const personName = useCallback(
    (id: string | null): string | null => (id ? (people.find((candidate) => candidate.id === id)?.fullName ?? null) : null),
    [people],
  );

  const journal = useMemo(
    () =>
      journalRows(events, {
        fieldLabel: (key) => fieldDefs.get(key)?.label ?? key,
        formatValue: (key, value) => (value === null ? null : resolveValue(meta, key, value)),
        actorName: personName,
      }),
    [events, fieldDefs, meta, personName],
  );

  const journalTypesList = useMemo(() => journalTypes(journal), [journal]);
  const journalVisible = useMemo(() => filterJournal(journal, journalType), [journal, journalType]);
  const returned = useMemo(() => lastReturn(events, { actorName: personName }), [events, personName]);

  const reviewCount = useMemo(() => reviewFieldKeys(groups).length, [groups]);

  async function saveField(field: TicketField): Promise<void> {
    setSavingKey(field.fieldKey);
    setNote(null);
    setRetry(null);
    try {
      const updated = await api.patch<TicketField>(
        `/api/tickets/${ticketId}/fields/${encodeURIComponent(field.fieldKey)}`,
        { value: draftValue.trim() === '' ? null : draftValue.trim() },
      );
      setDetail((previous) =>
        previous
          ? { ...previous, fields: previous.fields.map((item) => (item.fieldKey === field.fieldKey ? updated : item)) }
          : previous,
      );
      setEditingKey(null);
      const label = fieldDefs.get(field.fieldKey)?.label ?? field.fieldKey;
      setNote({ text: `Поле «${label}» сохранено — правка записана в журнал`, tone: 'ok' });
      trackAction?.('system');
      onChanged(ticketId);
      await readAll().catch(() => undefined);
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : 'Не удалось сохранить поле';
      setNote({ text, tone: 'error' });
      setRetry({ label: 'Сохранить поле ещё раз', run: () => void saveField(field) });
    } finally {
      setSavingKey(null);
    }
  }

  async function confirmTicket(): Promise<void> {
    if (!assigneeId) {
      setNote({ text: 'Выберите инженера: без исполнителя заявку назначить нельзя', tone: 'error' });
      return;
    }
    setConfirming(true);
    setNote(null);
    setRetry(null);
    try {
      await api.post(`/api/tickets/${ticketId}/confirm`, { assigneeId });
      setNote({ text: 'Заявка подтверждена и назначена — инженер получил задачу', tone: 'ok' });
      const fresh = await api
        .get<TicketResponse>(`/api/tickets/${ticketId}`)
        .catch(() => null);
      if (fresh) setDetail(fresh);
      setEvents(
        (await api.get<{ events: unknown[] }>(`/api/tickets/${ticketId}/events`).catch(() => ({ events: [] }))).events,
      );
      trackAction?.('system');
      onChanged(ticketId);
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : 'Не удалось подтвердить заявку';
      setNote({ text, tone: 'error' });
      setRetry({ label: 'Подтвердить ещё раз', run: () => void confirmTicket() });
    } finally {
      setConfirming(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      if (editingKey === null) {
        event.stopPropagation();
        onClose();
      }
      return;
    }
    if (event.key !== 'Enter' || event.defaultPrevented || editingKey !== null) return;
    if (isTypingTarget(event.target) || (event.target instanceof HTMLElement && event.target.closest('button, a'))) return;
    if (!detail || !canConfirm || detail.ticket.status !== 'in_review') return;
    event.preventDefault();
    void confirmTicket();
  }

  if (loading) {
    return (
      <Card className="ticket">
        <div className="ticket__skeleton" aria-label="Загружаем заявку">
          <div className="ticket__skeleton-line" style={{ width: '42%' }} />
          <div className="ticket__skeleton-line" style={{ width: '72%' }} />
          <div className="ticket__skeleton-line" style={{ width: '58%' }} />
        </div>
      </Card>
    );
  }

  if (error || !detail) {
    return (
      <Card tone="danger">
        <h2>Не удалось открыть заявку</h2>
        <p className="ugra-muted">{error ?? 'Заявка не найдена'}</p>
        <div className="page__actions">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setError(null);
              void readAll().catch(() => setError('Заявка всё ещё не открывается'));
            }}
          >
            Повторить
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            К списку
          </Button>
        </div>
      </Card>
    );
  }

  const { ticket, appeal } = detail;
  const categoryDef = fieldDefs.get('category');
  const category = categoryDef
    ? dictionaryLabel(meta, categoryDef, ticket.category)
    : (ticket.category ?? 'без категории');

  return (
    <div
      className="ticket"
      ref={rootRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      aria-keyshortcuts="Enter Escape"
      aria-label={`Заявка ${ticket.number}`}
    >
      <Card hero>
        <div className="ticket__head">
          <div className="ticket__top">
            <div>
              <span className="ticket__number">№ {ticket.number}</span>
              <h2 className="ticket__title">{category ?? 'Без категории'}</h2>
            </div>
            <div className="page__actions">
              <Badge tone={statusTone(ticket.status)} dot={ticket.status === 'in_review'}>
                {STATUS_LABELS[ticket.status]}
              </Badge>
              <PriorityBars priority={ticket.priority} isEmergency={ticket.isEmergency} withLabel />
              <Button variant="ghost" size="sm" onClick={onClose}>
                ← К очереди
              </Button>
            </div>
          </div>

          <div className="ticket__meta">
            <span>Канал: {appeal.channel}</span>
            <span>·</span>
            <span>Создана: {formatDateTime(ticket.createdAt)}</span>
            <span>·</span>
            <span>Исполнитель: {engineerName(ticket.assigneeId)}</span>
            {ticket.departmentId && (
              <>
                <span>·</span>
                <span>Подразделение: {ticket.departmentId}</span>
              </>
            )}
          </div>

          <DeadlineChips ticket={ticket} now={now} className="ticket__deadlines" />
        </div>
      </Card>

      {ticket.isEmergency && (
        <div className="ticket__banner" role="alert">
          <span className="ticket__banner-mark" aria-hidden="true">
            ⚠
          </span>
          <div>
            <div className="ticket__banner-title">Аварийная заявка</div>
            <div className="ticket__banner-text">
              Признаки аварии подтверждены. Уведомление дежурному ушло сразу — проверьте чек-лист регламента.
            </div>
          </div>
        </div>
      )}

      {returned && (
        <div className="dr-banner dr-banner--returned" role="status">
          <span className="dr-banner__mark" aria-hidden="true">
            ↩
          </span>
          <div>
            <div className="dr-banner__title">Возвращена инженером: {returned.reason ?? 'причина не указана'}</div>
            <div className="dr-banner__text">
              {returned.author}
              {returned.at ? ` · ${formatDateTime(returned.at)}` : ''}
              {returned.from ? ` · из статуса «${STATUS_LABELS[returned.from as keyof typeof STATUS_LABELS] ?? returned.from}»` : ''}
            </div>
          </div>
        </div>
      )}

      <div className="ticket__why">
        <strong>Почему такой приоритет: </strong>
        {priorityReason(ticket, detail.fields, (key, value) => {
          const item = meta.dictionaries.find((entry) => entry.dictionary === key && entry.code === value);
          return item?.label ?? value;
        })}
      </div>

      {note && (
        <div className={`dr-note dr-note--${note.tone}`} role={note.tone === 'error' ? 'alert' : 'status'}>
          <span className="dr-note__text">{note.text}</span>
          {note.tone === 'error' && retry && (
            <Button variant="secondary" size="sm" onClick={retry.run}>
              {retry.label}
            </Button>
          )}
        </div>
      )}

      <div className="dr-tabs" role="tablist" aria-label="Разделы заявки">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'fields'}
          className={`dr-tab${tab === 'fields' ? ' dr-tab--active' : ''}`}
          onClick={() => {
            setTab('fields');
            trackAction?.('click');
          }}
        >
          Поля
          <span className={`dr-tab__count${reviewCount > 0 ? ' dr-tab__count--warn' : ''}`}>{reviewCount}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'journal'}
          className={`dr-tab${tab === 'journal' ? ' dr-tab--active' : ''}`}
          onClick={() => {
            setTab('journal');
            trackAction?.('click');
          }}
        >
          Журнал
          <span className="dr-tab__count">{journal.length}</span>
        </button>
        <span className="dr-tabs__hint">
          <Kbd>Enter</Kbd> — подтвердить, <Kbd>Tab</Kbd> — только спорные поля
        </span>
      </div>

      {tab === 'fields' ? (
        <div className="ticket__body">
          <Card className="ticket__fields">
            <div className="ticket__section-head">
              <h3 className="ticket__section-title">Поля заявки</h3>
              <span className="ugra-dim">{reviewCount} на проверку</span>
            </div>

            {groups.length === 0 && <p className="ugra-muted">В реестре полей пока пусто.</p>}

            <div className="ticket__groups">
              {groups.map((group) => (
                <section className="ticket__section" key={group.group}>
                  <h4 className="ticket__section-title">{group.label}</h4>
                  {group.fields.map((entry) => {
                    const field = entry.field;
                    const value = resolveValue(meta, entry.key, entry.value);
                    const review = Boolean(field?.needsReview);
                    const editing = editingKey === entry.key && field !== null;
                    const def = fieldDefs.get(entry.key);
                    const options = dictionaryOptions(meta, def);
                    const corrected =
                      field?.origin === 'human' && field.aiValue !== null && String(field.aiValue) !== String(field.value ?? '');
                    return (
                      <div
                        key={entry.key}
                        className={`dr-field${review ? ' dr-field--review' : ''}${editing ? ' dr-field--editing' : ''}`}
                        tabIndex={review && field ? 0 : -1}
                        data-field-key={entry.key}
                        aria-label={review ? `Спорное поле ${entry.label}` : undefined}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter' || !review || !field || editing) return;
                          event.preventDefault();
                          event.stopPropagation();
                          setEditingKey(entry.key);
                          setDraftValue(value ?? '');
                          trackAction?.('click');
                        }}
                      >
                        <FieldRow
                          fieldKey={entry.key}
                          label={entry.label}
                          value={value}
                          confidence={field?.confidence}
                          quote={field?.quote?.text ?? null}
                          quoteSource="обращение"
                          origin={field?.origin}
                          needsReview={review}
                          emptyText="поле не заполнено — уйдёт в вопросы"
                          aside={
                            canEdit && field ? (
                              <button
                                type="button"
                                className="ticket__inline-link"
                                tabIndex={-1}
                                onClick={() => {
                                  setEditingKey(editing ? null : entry.key);
                                  setDraftValue(value ?? '');
                                  trackAction?.('click');
                                }}
                              >
                                {editing ? 'отмена' : 'изменить'}
                              </button>
                            ) : null
                          }
                        >
                          {editing && field && (
                            <div className="ticket__editor">
                              {options.length > 0 ? (
                                <select
                                  className="dr-editor__select"
                                  value={draftValue}
                                  autoFocus
                                  aria-label={`Новое значение поля ${entry.label}`}
                                  onChange={(event) => {
                                    setDraftValue(event.target.value);
                                    trackAction?.('select');
                                  }}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Escape') {
                                      event.stopPropagation();
                                      setEditingKey(null);
                                    }
                                    if (event.key === 'Enter') {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      void saveField(field);
                                    }
                                  }}
                                >
                                  <option value="">— не выбрано —</option>
                                  {options.map((option) => (
                                    <option value={option.code} key={option.code}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <input
                                  value={draftValue}
                                  autoFocus
                                  aria-label={`Новое значение поля ${entry.label}`}
                                  onChange={(event) => {
                                    setDraftValue(event.target.value);
                                    trackAction?.('input');
                                  }}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Escape') {
                                      event.stopPropagation();
                                      setEditingKey(null);
                                    }
                                    if (event.key === 'Enter') {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      void saveField(field);
                                    }
                                  }}
                                />
                              )}
                              <Button
                                variant="primary"
                                size="sm"
                                loading={savingKey === entry.key}
                                onClick={() => void saveField(field)}
                              >
                                Сохранить поле
                              </Button>
                            </div>
                          )}
                        </FieldRow>
                        {corrected && (
                          <p className="dr-field__history">
                            исправил диспетчер · ИИ предлагал «{String(field.aiValue)}»
                          </p>
                        )}
                      </div>
                    );
                  })}
                </section>
              ))}
            </div>
          </Card>

          <div className="ticket__side">
            <Card>
              <h3 className="ticket__section-title">Итог заявки</h3>
              <dl className="dr-summary">
                <div>
                  <dt>Приоритет</dt>
                  <dd>
                    <PriorityBars priority={ticket.priority} isEmergency={ticket.isEmergency} withLabel />
                  </dd>
                </div>
                <div>
                  <dt>Категория</dt>
                  <dd>{category ?? '—'}</dd>
                </div>
                <div>
                  <dt>Сроки</dt>
                  <dd>
                    <DeadlineChips ticket={ticket} now={now} />
                  </dd>
                </div>
                <div>
                  <dt>Исполнитель</dt>
                  <dd>{engineerName(ticket.assigneeId)}</dd>
                </div>
                <div>
                  <dt>Проверить полей</dt>
                  <dd>{reviewCount}</dd>
                </div>
              </dl>
            </Card>

            <Card>
              <h3 className="ticket__section-title">Оригинал обращения</h3>
              <div className="ticket__appeal">
                {segments.map((segment, index) =>
                  segment.quote ? <mark key={index}>{segment.text}</mark> : <span key={index}>{segment.text}</span>,
                )}
              </div>
            </Card>

            {canConfirm && (
              <Card>
                <h3 className="ticket__section-title">Подтверждение</h3>
                <div className="ticket__confirm">
                  <p className="ugra-muted">
                    {ticket.status === 'in_review'
                      ? 'Проверьте поля и назначьте инженера — заявка уйдёт в работу.'
                      : `Заявка в статусе «${STATUS_LABELS[ticket.status]}». Исполнитель: ${engineerName(ticket.assigneeId)}.`}
                  </p>
                  {ticket.status === 'in_review' && (
                    <>
                      <select
                        className="ticket__select"
                        value={assigneeId}
                        onChange={(event) => {
                          setAssigneeId(event.target.value);
                          setNote(null);
                          trackAction?.('select');
                        }}
                        aria-label="Исполнитель"
                      >
                        <option value="">Выберите инженера…</option>
                        {engineers.map((engineer) => (
                          <option value={engineer.id} key={engineer.id}>
                            {engineer.fullName} · {engineer.position}
                          </option>
                        ))}
                      </select>
                      <Button
                        variant="primary"
                        loading={confirming}
                        disabled={!assigneeId}
                        onClick={() => void confirmTicket()}
                        title={assigneeId ? 'Подтвердить и назначить (Enter)' : 'Сначала выберите инженера'}
                      >
                        Подтвердить и назначить <Kbd>Enter</Kbd>
                      </Button>
                      {!assigneeId && <p className="dr-hint dr-hint--warn">Без инженера кнопка неактивна.</p>}
                    </>
                  )}
                </div>
              </Card>
            )}
          </div>
        </div>
      ) : (
        <Card>
          <div className="dr-journal__head-bar">
            <h3 className="ticket__section-title">Журнал действий</h3>
            <label className="dr-journal__filter">
              <span>Тип события</span>
              <select value={journalType} onChange={(event) => setJournalType(event.target.value)}>
                <option value={JOURNAL_ALL}>Все события ({journal.length})</option>
                {journalTypesList.map((option) => (
                  <option value={option.type} key={option.type}>
                    {option.title} ({option.count})
                  </option>
                ))}
              </select>
            </label>
          </div>

          {journal.length === 0 && (
            <p className="ugra-muted">Журнал пуст: по этой заявке ещё нет событий.</p>
          )}
          {journal.length > 0 && journalVisible.length === 0 && (
            <p className="ugra-muted">По выбранному типу событий нет — выберите «Все события».</p>
          )}
          {journalVisible.length > 0 && (
            <ol className="dr-journal">
              {journalVisible.map((row) => (
                <JournalEntry row={row} key={row.id} />
              ))}
            </ol>
          )}
        </Card>
      )}
    </div>
  );
}
