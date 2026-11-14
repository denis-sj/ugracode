import './reply.css';
import type { ReplyDraft, TicketAnalysisResponse } from '@ugra/contracts';
import type { JSX } from 'react';
import { useCallback, useEffect, useState } from 'react';
import type { ApiClient } from '@ugra/ui';
import { Badge, Button, Card, Toast } from '@ugra/ui';
import { replyDraftFromAnalysis, replyDraftLabel, replyDraftText } from './format';

/**
 * Виджет `ticket.footer`: черновик ответа заявителю.
 *
 * Текст из `replyDraft` (GET /api/tickets/:id/analysis) можно поправить, скопировать
 * и — после подтверждения — отправить в чат обращения. Пока карточка заявки не
 * передаёт анализ в слот, виджет загружает его сам по `ticketId`.
 */
export interface ReplyFooterWidgetProps {
  api?: ApiClient;
  ticketId?: string;
  /** Готовый анализ, если карточка уже его загрузила. */
  analysis?: Record<string, unknown> | null;
  /** Готовый черновик, если он пришёл пропсами. `undefined` — загрузить из API. */
  replyDraft?: ReplyDraft | null;
  trackAction?: (kind: 'click' | 'input' | 'select' | 'navigate' | 'system') => void;
}

interface Loaded {
  draft: ReplyDraft | null;
}

interface SendReplyResponse {
  message: { id: string };
  ticketId: string;
}

type ToastState = { text: string; tone: 'ok' | 'danger' };

function resolveDraft(
  replyDraft: ReplyDraft | null | undefined,
  analysis: Record<string, unknown> | null | undefined,
  loaded: Loaded | null,
): ReplyDraft | null {
  if (replyDraft !== undefined) return replyDraft;
  if (analysis !== undefined) return replyDraftFromAnalysis(analysis);
  return loaded?.draft ?? null;
}

export function ReplyFooterWidget({
  api,
  ticketId,
  analysis,
  replyDraft,
  trackAction,
}: ReplyFooterWidgetProps): JSX.Element | null {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [text, setText] = useState('');
  const [touched, setTouched] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  const needsLoad = replyDraft === undefined && analysis === undefined;
  const canLoad = needsLoad && api !== undefined && ticketId !== undefined;

  useEffect(() => {
    if (!canLoad || !api || !ticketId) return undefined;
    let alive = true;
    void api
      .get<TicketAnalysisResponse>(`/api/tickets/${ticketId}/analysis`)
      .then((response) => {
        if (alive) setLoaded({ draft: replyDraftFromAnalysis(response.analysis) });
      })
      .catch(() => {
        if (alive) setLoaded({ draft: null });
      });
    return () => {
      alive = false;
    };
  }, [api, canLoad, ticketId]);

  const draft = resolveDraft(replyDraft, analysis, loaded);
  const draftText = replyDraftText(draft);

  useEffect(() => {
    if (!touched) setText(draftText);
  }, [draftText, touched]);

  const copy = useCallback(async (): Promise<void> => {
    const value = text.trim();
    if (value === '') return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('буфер обмена недоступен');
      await navigator.clipboard.writeText(value);
      setToast({ text: 'Текст скопирован', tone: 'ok' });
      trackAction?.('click');
    } catch {
      setToast({ text: 'Не удалось скопировать — выделите текст вручную', tone: 'danger' });
    }
  }, [text, trackAction]);

  const send = useCallback(async (): Promise<void> => {
    if (!api || !ticketId) return;
    const value = text.trim();
    if (value === '') {
      setToast({ text: 'Пустое сообщение отправлять нечего', tone: 'danger' });
      return;
    }
    setSending(true);
    try {
      await api.post<SendReplyResponse>(
        `/api/m/applicant-feedback/tickets/${encodeURIComponent(ticketId)}/reply`,
        { text: value },
      );
      setConfirmOpen(false);
      setSent(true);
      setToast({ text: 'Сообщение отправлено заявителю', tone: 'ok' });
      trackAction?.('system');
    } catch (cause) {
      setToast({
        text: cause instanceof Error ? cause.message : 'Не удалось отправить сообщение',
        tone: 'danger',
      });
    } finally {
      setSending(false);
    }
  }, [api, text, ticketId, trackAction]);

  if (canLoad && loaded === null) return null;

  const tone = draft === null ? 'neutral' : draft.template ? 'muted' : 'accent';
  const canSend = api !== undefined && ticketId !== undefined;

  return (
    <Card className="af-reply">
      <div className="af-reply__head">
        <span className="af-reply__eyebrow">Ответ заявителю</span>
        <Badge tone={tone}>{replyDraftLabel(draft)}</Badge>
      </div>

      <label className="af-reply__field">
        <span className="af-reply__caption">Черновик — можно поправить перед отправкой</span>
        <textarea
          className="af-reply__input"
          rows={4}
          value={text}
          placeholder="Напишите заявителю, что поняли и что будет дальше"
          onChange={(event) => {
            setText(event.target.value);
            setTouched(true);
            setSent(false);
            trackAction?.('input');
          }}
        />
      </label>

      <div className="af-reply__actions">
        <Button variant="secondary" size="sm" onClick={() => void copy()} disabled={text.trim() === ''}>
          Скопировать
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            setConfirmOpen(true);
            trackAction?.('click');
          }}
          disabled={!canSend || text.trim() === '' || sending}
          title={canSend ? 'Отправить заявителю в чат обращения' : 'Отправка недоступна в этом окне'}
        >
          Отправить заявителю
        </Button>
        {sent && (
          <span className="af-reply__sent" role="status">
            Отправлено в чат заявителя
          </span>
        )}
      </div>

      {confirmOpen && (
        <div className="af-reply__confirm" role="alertdialog" aria-label="Подтвердите отправку">
          <p>Отправить это сообщение заявителю? Оно появится в чате обращения от имени диспетчера.</p>
          <div className="af-reply__actions">
            <Button variant="primary" size="sm" loading={sending} onClick={() => void send()}>
              Отправить
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmOpen(false)}>
              Отмена
            </Button>
          </div>
        </div>
      )}

      <p className="af-reply__note">
        Черновик собран из данных заявки: номер, приоритет и срок. Заявитель получит сообщение только после
        подтверждения.
      </p>

      <Toast
        message={toast?.text ?? null}
        tone={toast?.tone ?? 'danger'}
        onClose={() => setToast(null)}
      />
    </Card>
  );
}
