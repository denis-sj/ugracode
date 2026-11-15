import type { Ticket } from '@ugra/contracts';
import type { JSX, KeyboardEvent } from 'react';
import { useState } from 'react';
import { Button, formatTicketStatus } from '@ugra/ui';
import { ACTION_LABELS, statusActions } from './format';

interface TaskActionsProps {
  ticket: Ticket;
  resultText: string;
  busy: string | null;
  onResultChange: (value: string) => void;
  onResolve: () => void;
  onTake: () => void;
  onExtend: () => void;
  onReturn: () => void;
}

/**
 * Действие задачи: одно поле результата и одна главная кнопка.
 * «Ещё» раскрывает редкие действия (продлить срок, вернуть диспетчеру), чтобы не спорить с главным.
 */
export function TaskActions({
  ticket,
  resultText,
  busy,
  onResultChange,
  onResolve,
  onTake,
  onExtend,
  onReturn,
}: TaskActionsProps): JSX.Element {
  const [moreOpen, setMoreOpen] = useState(false);
  const actions = statusActions(ticket.status);
  const canResolve = actions.includes('resolve');
  const canTake = actions.includes('take');

  if (canResolve) {
    const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
      if (event.key !== 'Enter' || event.shiftKey) return;
      event.preventDefault();
      if (resultText.trim() !== '') onResolve();
    };
    return (
      <div className="ed-actions">
        <div className="ed-result">
          <label className="ed-result__field">
            <span className="ugra-sr-only">Что сделано</span>
            <textarea
              className="ed-result__input"
              rows={1}
              value={resultText}
              placeholder="Что сделано — заявитель увидит в чате"
              onChange={(event) => onResultChange(event.target.value)}
              onKeyDown={onKeyDown}
            />
          </label>
          <Button variant="secondary" onClick={() => setMoreOpen((open) => !open)} aria-expanded={moreOpen}>
            Ещё
          </Button>
          <Button
            variant="primary"
            loading={busy === 'resolve'}
            disabled={resultText.trim() === ''}
            onClick={onResolve}
            title={resultText.trim() === '' ? 'Сначала опишите, что сделано' : 'Отправить результат заявителю'}
          >
            {ACTION_LABELS.resolve}
            <span className="ed-kbd" aria-hidden="true">
              Enter
            </span>
          </Button>
        </div>
        {moreOpen && (
          <div className="ed-actions__more">
            <Button variant="ghost" onClick={onExtend}>
              {ACTION_LABELS.extend}
            </Button>
            <Button variant="ghost" onClick={onReturn}>
              {ACTION_LABELS.return}
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (canTake) {
    return (
      <div className="ed-actions__row">
        <Button
          variant="primary"
          loading={busy === `take:${ticket.id}`}
          onClick={onTake}
        >
          {ACTION_LABELS.take}
        </Button>
        <Button variant="ghost" onClick={onReturn}>
          {ACTION_LABELS.return}
        </Button>
      </div>
    );
  }

  return (
    <div className="ed-done">
      <strong>
        {ticket.status === 'resolved' ? 'Выполнено, ждём заявителя' : formatTicketStatus(ticket.status)}
      </strong>
      <p>
        {ticket.resolution?.trim()
          ? `Что сделано: ${ticket.resolution.trim()}`
          : 'Результат работы в заявке не записан.'}
      </p>
    </div>
  );
}
