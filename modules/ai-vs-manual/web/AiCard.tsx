import type { TicketResponse } from '@ugra/contracts';
import type { JSX } from 'react';
import { Badge, Button, Card, FieldRow } from '@ugra/ui';
import type { AiFieldRow } from './format';

export interface AiCardProps {
  /** Идёт замер именно в этой колонке. */
  active: boolean;
  /** Идёт замер в другой колонке — старт заблокирован. */
  busy: boolean;
  loading: boolean;
  error: string | null;
  ticket: TicketResponse | null;
  rows: readonly AiFieldRow[];
  onStart: () => void;
  onFinish: () => void;
  onCancel: () => void;
  onRetry: () => void;
}

/** Колонка «С ИИ»: та же заявка, но поля уже заполнены — остаётся сверить и нажать «Готово». */
export function AiCard({
  active,
  busy,
  loading,
  error,
  ticket,
  rows,
  onStart,
  onFinish,
  onCancel,
  onRetry,
}: AiCardProps): JSX.Element {
  return (
    <section className="ugra-card ugra-card--padded measure-col measure-col--ai" aria-labelledby="measure-ai-title">
      <header className="measure-col__head">
        <span className="measure-eyebrow">Колонка 2</span>
        <div className="measure-col__title-row">
          <h2 id="measure-ai-title">С ИИ</h2>
          <Badge tone="accent">уверенность и цитаты</Badge>
        </div>
        <p className="measure-lead">
          Та же заявка из очереди: поля заполнены, у каждого — уверенность и цитата из обращения. Диспетчер
          сверяет и подтверждает.
        </p>
      </header>

      {!active ? (
        <div className="measure-start">
          <Button variant="primary" onClick={onStart} disabled={busy}>
            Начать замер с ИИ
          </Button>
          <span className="measure-hint">
            Откроется первая заявка из очереди — или та, что указана в <code>?ticket=…</code>.
          </span>
        </div>
      ) : loading ? (
        <>
          <p className="ugra-muted">Открываем заявку…</p>
          <div className="measure-col__actions">
            <Button variant="ghost" size="sm" onClick={onCancel}>
              Отменить замер
            </Button>
          </div>
        </>
      ) : error ? (
        <Card tone="danger">
          <p>Не удалось открыть заявку: {error}</p>
          <div className="measure-col__actions">
            <Button variant="secondary" size="sm" onClick={onRetry}>
              Повторить
            </Button>
            <Button variant="ghost" size="sm" onClick={onCancel}>
              Отменить замер
            </Button>
          </div>
        </Card>
      ) : ticket ? (
        <>
          <div className="measure-ticket">
            <span className="measure-ticket__number">№ {ticket.ticket.number}</span>
            <span className="measure-ticket__text">{ticket.appeal.originalText}</span>
          </div>

          <div className="measure-fields measure-fields--ai">
            {rows.length === 0 ? (
              <p className="ugra-muted">У заявки нет заполненных полей — проверять нечего.</p>
            ) : (
              rows.map((row) => (
                <FieldRow
                  key={row.key}
                  fieldKey={row.key}
                  label={row.label}
                  value={row.value}
                  confidence={row.confidence}
                  quote={row.quote}
                  quoteSource="обращение"
                  origin={row.origin ?? undefined}
                  needsReview={row.needsReview}
                  emptyText="поле не заполнено"
                />
              ))
            )}
          </div>

          <div className="measure-col__actions">
            <Button variant="primary" onClick={onFinish}>
              Готово
            </Button>
            <Button variant="ghost" onClick={onCancel}>
              Отменить
            </Button>
            <span className="measure-hint">Проверили поля — зафиксировали действия и время.</span>
          </div>
        </>
      ) : (
        <p className="ugra-muted">Заявка ещё не загружена.</p>
      )}
    </section>
  );
}
