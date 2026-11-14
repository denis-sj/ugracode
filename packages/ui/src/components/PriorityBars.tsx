import type { PriorityLevel } from '@ugra/contracts';
import type { JSX } from 'react';
import { cx } from '../cx';

/** Уровень → число закрашенных полосок (3.4): низкий 1, средний 2, высокий 3, критический/авария 4. */
const LEVEL_BARS: Record<PriorityLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
  emergency: 4,
};

/** Слово только для подсказки и скринридера — в таблицах приоритет показывается полосками. */
const LEVEL_LABEL: Record<PriorityLevel, string> = {
  low: 'Низкий приоритет',
  medium: 'Средний приоритет',
  high: 'Высокий приоритет',
  critical: 'Критический приоритет',
  emergency: 'Авария',
};

export interface PriorityBarsProps {
  level: PriorityLevel | null | undefined;
  /** Слово рядом с индикатором (в шапке карточки). */
  withLabel?: boolean;
  className?: string;
}

/** Четыре вертикальные полоски-«уровень сигнала»: индикатор приоритета без слова в таблице. */
export function PriorityBars({ level, withLabel = false, className }: PriorityBarsProps): JSX.Element {
  const bars = level ? LEVEL_BARS[level] : 0;
  const label = level ? LEVEL_LABEL[level] : 'Приоритет не определён';
  return (
    <span className={cx('ugra-priority-wrap', className)} title={label}>
      <span className={cx('ugra-priority', level && `ugra-priority--${level}`)} role="img" aria-label={label}>
        {[0, 1, 2, 3].map((index) => (
          <span
            key={index}
            className={cx('ugra-priority__bar', index < bars && 'ugra-priority__bar--on')}
            aria-hidden="true"
          />
        ))}
      </span>
      {withLabel && <span className="ugra-priority__label">{label}</span>}
    </span>
  );
}
