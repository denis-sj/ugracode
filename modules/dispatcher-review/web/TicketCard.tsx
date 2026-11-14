import type { FieldDef, MetaResponse, TicketField, TicketResponse, User, UsersResponse } from '@ugra/contracts';
import { hasPermission } from '@ugra/contracts';
import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, FieldRow, Timeline, formatDateTime } from '@ugra/ui';
import type { ApiClient, BadgeTone, TimelineItem, WebPageProps } from '@ugra/ui';
import {
  groupTicketFields,
  highlightQuotes,
  PRIORITY_LABELS,
  priorityReason,
  priorityTone,
  STATUS_LABELS,
  statusTone,
  toTimelineItems,
} from './format';

type MessageTone = 'ok' | 'error';

export interface TicketCardProps {
  api: ApiClient;
  meta: MetaResponse;
  user: WebPageProps['user'];
  ticketId: string;
  onClose: () => void;
  onChanged: () => void;
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

/** Карточка заявки: поля по группам, уверенность, цитаты, след, подтверждение и журнал. */
export function TicketCard({ api, meta, user, ticketId, onClose, onChanged, trackAction }: TicketCardProps): JSX.Element {
  const [detail, setDetail] = useState<TicketResponse | null>(null);
  const [events, setEvents] = useState<unknown[]>([]);
  const [engineers, setEngineers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState('');
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [assigneeId, setAssigneeId] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState<{ text: string; tone: MessageTone } | null>(null);

  const canEdit = hasPermission(user.role, 'tickets.edit');
  const canConfirm = hasPermission(user.role, 'tickets.confirm');

  const reload = useCallback(async (): Promise<TicketResponse | null> => {
    const [nextDetail, nextEvents] = await Promise.all([
      api.get<TicketResponse>(`/api/tickets/${ticketId}`),
      api.get<{ events: unknown[] }>(`/api/tickets/${ticketId}/events`).catch(() => ({ events: [] })),
    ]);
    setDetail(nextDetail);
    setEvents(nextEvents.events);
    return nextDetail;
  }, [api, ticketId]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setDetail(null);
    setEditingKey(null);
    setNote(null);

    Promise.all([
      api.get<TicketResponse>(`/api/tickets/${ticketId}`),
      api.get<{ events: unknown[] }>(`/api/tickets/${ticketId}/events`).catch(() => ({ events: [] })),
      api.get<UsersResponse>('/api/users'),
    ])
      .then(([nextDetail, nextEvents, users]) => {
        if (!alive) return;
        setDetail(nextDetail);
        setEvents(nextEvents.events);
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

  const groups = useMemo(
    () => (detail ? groupTicketFields(detail.fields, meta.fields) : []),
    [detail, meta.fields],
  );

  const segments = useMemo(() => {
    if (!detail) return [];
    const quotes = detail.fields.map((field) => field.quote?.text).filter((quote): quote is string => Boolean(quote));
    return highlightQuotes(detail.appeal.originalText, quotes);
  }, [detail]);

  const timeline = useMemo<TimelineItem[]>(
    () =>
      toTimelineItems(events).map((item) => ({
        id: item.id,
        title: item.title,
        description: item.description,
        at: item.at ? formatDateTime(item.at) : undefined,
        tone: item.tone as BadgeTone,
      })),
    [events],
  );

  const engineerName = (id: string | null): string =>
    id ? (engineers.find((candidate) => candidate.id === id)?.fullName ?? id) : 'не назначен';

  async function saveField(field: TicketField): Promise<void> {
    setSavingKey(field.fieldKey);
    setNote(null);
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
      setNote({ text: `Поле «${field.fieldKey}» сохранено`, tone: 'ok' });
      trackAction?.('system');
      onChanged();
      const refreshed = await api
        .get<{ events: unknown[] }>(`/api/tickets/${ticketId}/events`)
        .catch(() => ({ events: [] }));
      setEvents(refreshed.events);
    } catch (cause) {
      setNote({ text: cause instanceof Error ? cause.message : 'Не удалось сохранить поле', tone: 'error' });
    } finally {
      setSavingKey(null);
    }
  }

  async function confirmTicket(): Promise<void> {
    if (!assigneeId) return;
    setConfirming(true);
    setNote(null);
    try {
      await api.post(`/api/tickets/${ticketId}/confirm`, { assigneeId });
      await reload();
      setNote({ text: 'Заявка подтверждена и назначена', tone: 'ok' });
      trackAction?.('system');
      onChanged();
    } catch (cause) {
      setNote({ text: cause instanceof Error ? cause.message : 'Не удалось подтвердить заявку', tone: 'error' });
    } finally {
      setConfirming(false);
    }
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
          <Button variant="secondary" size="sm" onClick={() => void reload()}>
            Обновить
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            К списку
          </Button>
        </div>
      </Card>
    );
  }

  const { ticket, appeal } = detail;
  const categoryDef = meta.fields.find((def) => def.key === 'category');
  const category = categoryDef
    ? dictionaryLabel(meta, categoryDef, ticket.category)
    : (ticket.category ?? 'без категории');

  return (
    <div className="ticket">
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
              <Badge tone={priorityTone(ticket.priority)} dot={ticket.isEmergency}>
                {PRIORITY_LABELS[ticket.priority ?? 'medium']}
              </Badge>
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

      <div className="ticket__why">
        <strong>Почему такой приоритет: </strong>
        {priorityReason(ticket, detail.fields, (key, value) => {
          const item = meta.dictionaries.find((entry) => entry.dictionary === key && entry.code === value);
          return item?.label ?? value;
        })}
      </div>

      <div className="ticket__body">
        <Card className="ticket__fields">
          <div className="ticket__section-head">
            <h3 className="ticket__section-title">Поля заявки</h3>
            <span className="ugra-dim">
              {detail.fields.filter((field) => field.needsReview).length} на проверку
            </span>
          </div>

          {groups.length === 0 && <p className="ugra-muted">В реестре полей пока пусто.</p>}

          <div className="ticket__groups">
            {groups.map((group) => (
              <section className="ticket__section" key={group.group}>
                <h4 className="ticket__section-title">{group.label}</h4>
                {group.fields.map((entry) => {
                  const field = entry.field;
                  const value = resolveValue(meta, entry.key, entry.value);
                  const editing = editingKey === entry.key && field !== null;
                  return (
                    <FieldRow
                      key={entry.key}
                      fieldKey={entry.key}
                      label={entry.label}
                      value={value}
                      confidence={field?.confidence}
                      quote={field?.quote?.text ?? null}
                      quoteSource="обращение"
                      origin={field?.origin}
                      needsReview={field?.needsReview}
                      emptyText="поле не заполнено — уйдёт в вопросы"
                      aside={
                        canEdit && field ? (
                          <button
                            type="button"
                            className="ticket__inline-link"
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
                          <input
                            value={draftValue}
                            onChange={(event) => setDraftValue(event.target.value)}
                            aria-label={`Новое значение поля ${entry.label}`}
                          />
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
                  );
                })}
              </section>
            ))}
          </div>
        </Card>

        <div className="ticket__side">
          {note && <div className={`ticket__note ticket__note--${note.tone}`}>{note.text}</div>}

          <Card>
            <h3 className="ticket__section-title">Оригинал обращения</h3>
            <div className="ticket__appeal">
              {segments.map((segment, index) =>
                segment.quote ? (
                  <mark key={index}>{segment.text}</mark>
                ) : (
                  <span key={index}>{segment.text}</span>
                ),
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
                      onChange={(event) => setAssigneeId(event.target.value)}
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
                    >
                      Подтвердить и назначить
                    </Button>
                  </>
                )}
              </div>
            </Card>
          )}

          <Card>
            <h3 className="ticket__section-title">Журнал действий</h3>
            <Timeline items={timeline} empty="Событий по заявке пока нет" />
          </Card>
        </div>
      </div>
    </div>
  );
}
