import { shortTicketNumber } from '@ugra/contracts';
import type { Ticket } from '@ugra/contracts';
import type { JSX } from 'react';
import { PersonAvatar, PriorityMark, formatDateTime } from '@ugra/ui';
import type { DueState } from './format';
import { capitalizeFirst, dueBadgeLabel } from './format';

interface TaskHeaderProps {
  ticket: Ticket;
  title: string;
  place: string;
  equipment: string;
  applicantName: string | null;
  sla: DueState | null;
}

/** Шапка текущей задачи: приоритет, номер, срок, тема человеческим языком и заявитель. */
export function TaskHeader({
  ticket,
  title,
  place,
  equipment,
  applicantName,
  sla,
}: TaskHeaderProps): JSX.Element {
  const dueTone = sla ? ` ed-deadline--${sla.tone}` : '';
  const parts = [place, equipment].filter((value) => value !== '');

  return (
    <header className="ed-task__head">
      <div className="ed-task__top">
        <p className="ed-task__meta">
          <PriorityMark priority={ticket.priority} isEmergency={ticket.isEmergency} withLabel />
          <span className="ed-task__num">
            № {shortTicketNumber(ticket.number)} · создана {formatDateTime(ticket.createdAt)}
          </span>
        </p>
        <span className={'ed-deadline' + dueTone}>{dueBadgeLabel(sla)}</span>
      </div>

      <h1 className="ed-task__title">{capitalizeFirst(title)}</h1>

      <div className="ed-task__who">
        {applicantName && <PersonAvatar name={applicantName} size={34} />}
        <b>{applicantName ?? 'Заявитель не указан'}</b>
        {parts.length > 0 && <span>· {parts.join(' · ')}</span>}
      </div>
    </header>
  );
}
