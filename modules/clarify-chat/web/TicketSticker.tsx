import type { MetaResponse, TicketResponse, User } from '@ugra/contracts';
import type { JSX } from 'react';
import {
  TICKET_STAGES,
  formatDayTime,
  formatDue,
  formatTicketStatus,
  ticketStage,
  ticketStatusTone,
} from '@ugra/ui';
import type { AnswerMap } from './format';
import { fieldValues, stickerRows, ticketTitle } from './format';

export interface TicketStickerProps {
  detail: TicketResponse;
  meta: MetaResponse;
  users: readonly User[];
  answers: AnswerMap;
  className?: string;
}

const DRAFT_STATUSES = new Set(['new', 'ai_draft', 'waiting_applicant']);

/** Стикер «Ваше обращение» справа от чата: заполняется по ходу, в ленту не пишется. */
export function TicketSticker({ detail, meta, users, answers, className }: TicketStickerProps): JSX.Element {
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
  const numberText = DRAFT_STATUSES.has(ticket.status)
    ? `Черновик · ${formatDayTime(ticket.createdAt)}`
    : `№ ${ticket.number} · ${formatDayTime(ticket.createdAt)}`;

  return (
    <aside className={className ? `chat-sticker ${className}` : 'chat-sticker'} aria-label="Ваше обращение">
      <header className="chat-sticker__head">
        <div className="chat-sticker__eyebrow-row">
          <span className="chat-sticker__eyebrow">Ваше обращение</span>
          <span className={`chat-sticker__status chat-sticker__status--${tone}`}>
            {formatTicketStatus(ticket.status)}
          </span>
        </div>
        <div className="chat-sticker__title">{title}</div>
        <div className="chat-sticker__number">{numberText}</div>
      </header>

      <div className="chat-sticker__body">
        {rows.map((row) => (
          <div className="chat-sticker__field" key={row.key}>
            <div className="chat-sticker__label">{row.label}</div>
            <div className={`chat-sticker__value chat-sticker__value--${row.tone}`}>{row.value}</div>
          </div>
        ))}

        <div className="chat-sticker__scale" aria-hidden="true">
          {TICKET_STAGES.map((label, index) => (
            <span
              key={label}
              className={index < stage ? 'chat-sticker__seg chat-sticker__seg--on' : 'chat-sticker__seg'}
            />
          ))}
        </div>
        <div className="chat-sticker__scale-legend">
          {TICKET_STAGES.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
      </div>
    </aside>
  );
}
