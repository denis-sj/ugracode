import type { Ticket } from '@ugra/contracts';
import type { JSX, ReactNode } from 'react';
import { formatDateTime } from '@ugra/ui';
import { PRIORITY_LABELS, ticketDeadlines } from './format';

/** Мелкие части карточки и очереди в стиле дизайн-системы: цвета — только из токенов. */

const PRIORITY_LEVEL: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4, emergency: 4 };

export interface PriorityBarsProps {
  priority: Ticket['priority'];
  isEmergency?: boolean;
  /** Показать слово рядом (только в шапке карточки; в таблице — индикатор без слова). */
  withLabel?: boolean;
}

/** Приоритет четырьмя полосками: как уровень сигнала, критический — красным. */
export function PriorityBars({ priority, isEmergency = false, withLabel = false }: PriorityBarsProps): JSX.Element {
  const level = isEmergency ? 4 : priority ? (PRIORITY_LEVEL[priority] ?? 0) : 0;
  const alert = isEmergency || priority === 'critical' || priority === 'emergency';
  const label = isEmergency ? 'Авария' : priority ? PRIORITY_LABELS[priority] : 'Без приоритета';
  return (
    <span className={`dr-priority${alert ? ' dr-priority--alert' : ''}`} role="img" aria-label={`Приоритет: ${label}`} title={label}>
      {[1, 2, 3, 4].map((bar) => (
        <span key={bar} className={`dr-priority__bar${bar <= level ? ' dr-priority__bar--on' : ''}`} aria-hidden="true" />
      ))}
      {withLabel && <span className="dr-priority__label">{label}</span>}
    </span>
  );
}

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
