import './review.css';
import type { AssigneeCandidate, MetaResponse, Ticket, TicketResponse, User } from '@ugra/contracts';
import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button, DetailRow, OriginBadge, PriorityMark, Sticker } from '@ugra/ui';
import type { WebPageProps } from '@ugra/ui';
import { Kbd } from './parts';
import {
  candidatePercent,
  fieldDisplayValue,
  formatLocation,
  locationFromTicket,
  PRIORITY_LABELS,
  STATUS_LABELS,
  statusTone,
  ticketTitleFromFields,
} from './format';

export interface QueuePreviewProps {
  ticket: Ticket;
  detail: TicketResponse | null;
  meta: MetaResponse;
  api: WebPageProps['api'];
  users: readonly User[];
  canConfirm: boolean;
  navigate: WebPageProps['navigate'];
  onClose: () => void;
  onChanged: () => void;
  trackAction?: WebPageProps['trackAction'];
}

const PREVIEW_KEYS = ['equipment', 'model', 'building', 'cabinet', 'symptoms', 'urgency'] as const;

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** Превью выбранной заявки справа от очереди: цитата, поля, исполнитель, подтверждение. */
export function QueuePreview({
  ticket,
  detail,
  meta,
  api,
  users,
  canConfirm,
  navigate,
  onClose,
  onChanged,
  trackAction,
}: QueuePreviewProps): JSX.Element {
  const [loaded, setLoaded] = useState<TicketResponse | null>(detail);
  const [candidates, setCandidates] = useState<AssigneeCandidate[]>([]);
  const [assigneeId, setAssigneeId] = useState(ticket.assigneeId ?? '');
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoaded(detail);
  }, [detail]);

  useEffect(() => {
    setAssigneeId(ticket.assigneeId ?? '');
  }, [ticket.assigneeId, ticket.id]);

  useEffect(() => {
    let alive = true;
    if (!loaded) {
      api
        .get<TicketResponse>(`/api/tickets/${ticket.id}`)
        .then((response) => {
          if (alive) setLoaded(response);
        })
        .catch(() => undefined);
    }
    return () => {
      alive = false;
    };
  }, [api, loaded, ticket.id]);

  useEffect(() => {
    let alive = true;
    api
      .get<{ candidates: AssigneeCandidate[] }>(`/api/m/routing/candidates/${ticket.id}`)
      .then((response) => {
        if (!alive) return;
        setCandidates(response.candidates);
        setAssigneeId((current) => current || response.candidates[0]?.userId || '');
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [api, ticket.id]);

  const assigneeName = useCallback(
    (id: string | null): string | null => users.find((user) => user.id === id)?.fullName ?? null,
    [users],
  );

  const top = candidates[0];
  const bestScore = top?.score ?? 1;
  const selectedCandidate = candidates.find((candidate) => candidate.userId === assigneeId) ?? top;
  const routePlace = useMemo(() => {
    if (!loaded) return 'место уточняется';
    return formatLocation(locationFromTicket(loaded.ticket, loaded.fields), (code) => {
      return meta.dictionaries.find((entry) => entry.dictionary === 'building' && entry.code === code)?.label ?? code;
    });
  }, [loaded, meta.dictionaries]);

  const title = useMemo(() => {
    if (!loaded) return 'Обращение';
    return ticketTitleFromFields(loaded.fields, (key, value) => {
      if (key === 'category') {
        return meta.dictionaries.find((entry) => entry.dictionary === 'category' && entry.code === value)?.label ?? value;
      }
      return value;
    });
  }, [loaded, meta.dictionaries]);

  const fields = useMemo(() => {
    if (!loaded) return [];
    const byKey = new Map(loaded.fields.map((field) => [field.fieldKey, field]));
    return PREVIEW_KEYS.flatMap((key) => {
      const field = byKey.get(key);
      if (!field) return [];
      const label = meta.fields.find((def) => def.key === key)?.label ?? key;
      const value = fieldDisplayValue(meta, key, field.value === null ? null : String(field.value));
      if (!value) return [];
      return [{ key, label, value, origin: field.origin }];
    }).slice(0, 5);
  }, [loaded, meta]);

  const quoteRaw = loaded?.appeal.originalText ?? '';
  const quote = quoteRaw.length > 240 ? `${quoteRaw.slice(0, 238)}…` : quoteRaw;

  const confirm = useCallback(async (): Promise<void> => {
    if (ticket.status !== 'in_review') return;
    if (!assigneeId) {
      setError('Выберите исполнителя в проверке заявки.');
      return;
    }
    setConfirming(true);
    setError(null);
    setNote(null);
    try {
      await api.post(`/api/tickets/${ticket.id}/confirm`, { assigneeId });
      setNote(`Назначена: ${assigneeName(assigneeId) ?? 'инженер'} получил задачу.`);
      trackAction?.('system');
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось подтвердить заявку');
    } finally {
      setConfirming(false);
    }
  }, [api, assigneeId, assigneeName, onChanged, ticket.id, ticket.status, trackAction]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Enter' || event.defaultPrevented) return;
      if (isTypingTarget(event.target) || (event.target instanceof HTMLElement && event.target.closest('button, a'))) {
        return;
      }
      if (ticket.status !== 'in_review' || !canConfirm) return;
      event.preventDefault();
      void confirm();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canConfirm, confirm, ticket.status]);

  return (
    <Sticker
      label={`Заявка ${ticket.number}`}
      tone={ticket.isEmergency ? 'danger' : 'default'}
      className="queue-preview"
    >
      <header className="queue-preview__head">
        <div className="queue-preview__top">
          <span className="queue-preview__number">
            № {ticket.number} · {loaded?.appeal.channel ?? 'чат'}
          </span>
          <span className="queue-preview__priority">
            <PriorityMark priority={ticket.priority} isEmergency={ticket.isEmergency} />
            {ticket.isEmergency ? 'Авария' : ticket.priority ? PRIORITY_LABELS[ticket.priority] : 'Без приоритета'}
          </span>
        </div>
        <div className="queue-preview__title">{title}</div>
        <div className="queue-preview__place">{routePlace}</div>
        <div className="queue-preview__status">
          <Badge tone={statusTone(ticket.status)} dot={ticket.status === 'in_review'}>
            {STATUS_LABELS[ticket.status]}
          </Badge>
          <button type="button" className="queue-preview__close" aria-label="Закрыть превью" onClick={onClose}>
            ×
          </button>
        </div>
      </header>

      <div className="queue-preview__body">
        {quote && <blockquote className="queue-preview__quote">«{quote}»</blockquote>}

        {fields.length > 0 && (
          <div className="queue-preview__fields">
            {fields.map((field) => (
              <DetailRow
                key={field.key}
                layout="stack"
                label={field.label}
                value={field.value}
                hint={<OriginBadge origin={field.origin} />}
              />
            ))}
          </div>
        )}

        <div className="queue-preview__candidate">
          <span className="queue-preview__candidate-label">Исполнитель — предложение ИИ</span>
          {selectedCandidate ? (
            <>
              <b className="queue-preview__candidate-name">
                {assigneeName(selectedCandidate.userId) ?? selectedCandidate.userId}
                <span>{candidatePercent(selectedCandidate.score, bestScore)}%</span>
              </b>
              <p className="queue-preview__candidate-why">
                {selectedCandidate.reasons.slice(0, 2).join(' · ') || 'Подобран по категории и загрузке'}
              </p>
            </>
          ) : (
            <p className="queue-preview__candidate-why">
              Кандидатов нет — выберите инженера на шаге проверки.
            </p>
          )}
        </div>

        {note && (
          <p className="queue-preview__note" role="status">
            {note}
          </p>
        )}
        {error && (
          <p className="queue-preview__error" role="alert">
            {error}
          </p>
        )}
      </div>

      <footer className="queue-preview__actions">
        <Button
          variant="primary"
          loading={confirming}
          disabled={!canConfirm || ticket.status !== 'in_review' || !assigneeId}
          title={!canConfirm ? 'Нет права подтверждать заявку' : assigneeId ? 'Подтвердить и назначить (Enter)' : 'Сначала откройте проверку и выберите инженера'}
          onClick={() => void confirm()}
        >
          {ticket.status === 'in_review' ? (
            <>
              Подтвердить <Kbd>Enter</Kbd>
            </>
          ) : (
            'Заявка назначена'
          )}
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            trackAction?.('navigate');
            navigate(`/review?id=${encodeURIComponent(ticket.id)}`);
          }}
        >
          Открыть
        </Button>
      </footer>
    </Sticker>
  );
}
