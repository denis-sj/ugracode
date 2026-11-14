import type { Ticket } from '@ugra/contracts';
import type { JSX, ReactNode } from 'react';
import { formatDateTime } from '@ugra/ui';
import { ticketDeadlines } from './format';

/** Мелкие части очереди и проверки: цвета — только из токенов. */

export interface DeadlineChipsProps {
  ticket: Pick<Ticket, 'reactDueAt' | 'slaDueAt'>;
  now: number;
  className?: string;
}

/**
 * Два срока по регламенту: «реакция 12 мин» и «решение 2 ч».
 * Просрочка — красная плашка с пульсом, меньше 15 минут — жёлтая.
 */
export function DeadlineChips({ ticket, now, className }: DeadlineChipsProps): JSX.Element {
  const items = ticketDeadlines(ticket, now);
  if (items.length === 0) {
    return <span className={`dr-deadline dr-deadline--empty${className ? ` ${className}` : ''}`}>срок не задан</span>;
  }
  return (
    <span className={`dr-deadlines${className ? ` ${className}` : ''}`}>
      {items.map((item) => (
        <span
          key={item.kind}
          className={`dr-deadline dr-deadline--${item.tone}${item.overdue ? ' dr-deadline--overdue' : ''}`}
          title={`${item.label}: до ${formatDateTime(item.dueAt)}`}
        >
          <span className="dr-deadline__label">{item.label}</span>
          <span className="dr-deadline__value">{item.text}</span>
        </span>
      ))}
    </span>
  );
}

/** Подсказка клавиши внутри кнопки: «Подтвердить и назначить [Enter]». */
export function Kbd({ children }: { children: ReactNode }): JSX.Element {
  return <kbd className="dr-kbd">{children}</kbd>;
}
