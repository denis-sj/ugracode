import type { PriorityLevel } from '@ugra/contracts';
import type { JSX } from 'react';
import { cx } from '../cx';

export interface PriorityMarkProps {
  priority: PriorityLevel | null;
  isEmergency?: boolean;
  /** Показать слово рядом; в таблице очередь оставляет только круг. */
  withLabel?: boolean;
  className?: string;
}

const LABELS: Record<PriorityLevel, string> = {
  emergency: 'Авария',
  critical: 'Критический',
  high: 'Высокий',
  medium: 'Средний',
  low: 'Низкий',
};

const FILL: Record<PriorityLevel, number> = {
  emergency: 100,
  critical: 100,
  high: 75,
  medium: 50,
  low: 25,
};

/** Приоритет кругом-долей (3.4): низкий — четверть, высокий — три четверти, критический — целиком. */
export function PriorityMark({
  priority,
  isEmergency = false,
  withLabel = false,
  className,
}: PriorityMarkProps): JSX.Element {
  const level: PriorityLevel | null = isEmergency ? 'emergency' : priority;
  const label = level ? LABELS[level] : 'Без приоритета';
  const fill = level ? FILL[level] : 0;
  return (
    <span
      className={cx('ugra-pmark', level && `ugra-pmark--${level}`, withLabel && 'ugra-pmark--labelled', className)}
      role="img"
      aria-label={`Приоритет: ${label}`}
      title={label}
    >
      <span
        className="ugra-pmark__circle"
        style={level ? { background: `conic-gradient(currentColor 0 ${fill}%, transparent 0)` } : undefined}
        aria-hidden="true"
      />
      {withLabel && <span className="ugra-pmark__label">{label}</span>}
    </span>
  );
}
