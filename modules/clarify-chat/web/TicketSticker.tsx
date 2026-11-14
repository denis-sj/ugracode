import type { MetaResponse, TicketResponse, User } from '@ugra/contracts';
import type { JSX } from 'react';
import {
  DetailRow,
  ProgressScale,
  TICKET_STAGES,
  formatDayTime,
  formatDue,
  formatTicketStatus,
  ticketStage,
  ticketStatusTone,
} from '@ugra/ui';
import type { AnalysisView, AnswerMap } from './format';
import { emergencyBadge, fieldValues, stickerRows, ticketTitle } from './format';

export interface TicketStickerProps {
  detail: TicketResponse;
  meta: MetaResponse;
  users: readonly User[];
  answers: AnswerMap;
  /** Разбор из `GET /api/tickets/:id/analysis`: авария и её признаки. */
  analysis?: AnalysisView | null;
  className?: string;
}

const DRAFT_STATUSES = new Set(['new', 'ai_draft', 'waiting_applicant']);

/** Стикер «Ваше обращение» справа от чата: заполняется по ходу, в ленту не пишется. */
export function TicketSticker({
  detail,
  meta,
  users,
  answers,
  analysis,
  className,
}: TicketStickerProps): JSX.Element {
  const { ticket } = detail;
  const values = fieldValues(detail.fields, answers);
  const assignee = ticket.assigneeId ? users.find((user) => user.id === ticket.assigneeId) : undefined;
  const title = ticketTitle({ fields: values, fieldsMeta: meta.fields, dictionaries: meta.dictionaries });
  const rows = stickerRows({
    fields: values,
    fieldsMeta: meta.fields,
    dictionaries: meta.dictionaries,
    answers,
    assigneeName: assignee?.fullName ?? null,
    due: formatDue(ticket.slaDueAt),
  });

  const stage = ticketStage(ticket.status);
  const tone = ticketStatusTone(ticket.status);
  const emergency = emergencyBadge(analysis);
  const numberText = DRAFT_STATUSES.has(ticket.status)
    ? `Черновик · ${formatDayTime(ticket.createdAt)}`
    : `№ ${ticket.number} · ${formatDayTime(ticket.createdAt)}`;

  return (
    <aside
      className={className ? `chat-sticker ${className}` : 'chat-sticker'}
      aria-label="Ваше обращение"
      data-reveal
    >
      <header className="chat-sticker__head">
        <div className="chat-sticker__eyebrow-row">
          <span className="chat-sticker__eyebrow">Ваше обращение</span>
          <span className={`chat-sticker__status chat-sticker__status--${tone}`}>
            {formatTicketStatus(ticket.status)}
          </span>
        </div>
        <div className="chat-sticker__title">{title}</div>
        <div className="chat-sticker__number">{numberText}</div>
        {emergency && (
          <div className="chat-sticker__emergency" title={emergency.title}>
            <span className="chat-sticker__emergency-dot" aria-hidden="true" />
            {emergency.text}
          </div>
        )}
      </header>

      <div className="chat-sticker__body">
        {rows.map((row) => (
          <div className="chat-sticker__row" key={row.key} data-reveal>
            <DetailRow
              layout="stack"
              label={row.label}
              value={row.value}
              tone={row.tone === 'wait' ? 'muted' : row.tone === 'accent' ? 'accent' : 'default'}
            />
          </div>
        ))}

        <ProgressScale className="chat-sticker__progress" stage={stage} labels={TICKET_STAGES} showLabels />
      </div>
    </aside>
  );
}
