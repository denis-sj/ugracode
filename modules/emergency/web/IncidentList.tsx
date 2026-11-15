import type { Ticket } from '@ugra/contracts';
import type { JSX } from 'react';
import { PriorityMark, formatTicketNumber, formatTicketStatus, ticketStatusTone } from '@ugra/ui';
import { incidentTimer, placeLabel, type Place } from './format';

export interface IncidentListProps {
  tickets: readonly Ticket[];
  places: Record<string, Place>;
  activeId: string | null;
  now: number;
  loading: boolean;
  onSelect: (id: string) => void;
}

/**
 * Список аварийных заявок слева: приоритет «шаром», статус точкой, без заливок.
 * Две строки на заявку — номер и возраст, ниже статус и место.
 */
export function IncidentList({
  tickets,
  places,
  activeId,
  now,
  loading,
  onSelect,
}: IncidentListProps): JSX.Element {
  return (
    <div className="er-list__rows">
      {loading && tickets.length === 0 && <p className="er-list__empty">Загружаем аварийные заявки…</p>}
      {!loading && tickets.length === 0 && <p className="er-list__empty">Аварийных заявок нет.</p>}

      {tickets.map((ticket) => {
        const place = places[ticket.id];
        const active = ticket.id === activeId;
        const timer = incidentTimer(ticket.createdAt, now);
        const placeText = place === undefined ? '—' : placeLabel(place);
        const tone = ticketStatusTone(ticket.status);
        return (
          <button
            type="button"
            key={ticket.id}
            className={active ? 'er-row er-row--on' : 'er-row'}
            aria-current={active ? 'true' : undefined}
            onClick={() => onSelect(ticket.id)}
          >
            <span className="er-row__top">
              <span className="er-row__num">
                <PriorityMark priority={ticket.priority} isEmergency />
                <span className="er-row__number">{formatTicketNumber(ticket.number)}</span>
              </span>
            </span>
            <span className="er-row__meta">
              <span className="er-row__line">
                <span className={`er-status er-status--${tone}`}>
                  <span className="er-status__dot" aria-hidden="true" />
                  {formatTicketStatus(ticket.status)}
                </span>
                <span className="er-row__age">{timer.age}</span>
              </span>
              <span className="er-row__place">
                {placeText === '—' ? 'место не указано' : placeText}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
