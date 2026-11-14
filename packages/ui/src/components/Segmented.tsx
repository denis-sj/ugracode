import type { JSX } from 'react';
import { cx } from '../cx';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  count?: number;
}

export interface SegmentedProps<T extends string> {
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  /** Подпись группы для скринридера. */
  label?: string;
  className?: string;
}

/** Сегментированный переключатель в стеклянной капсуле: активный сегмент — белая плашка. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label = 'Фильтр',
  className,
}: SegmentedProps<T>): JSX.Element {
  return (
    <div className={cx('ugra-segmented', className)} role="group" aria-label={label}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            className={cx('ugra-segmented__item', active && 'ugra-segmented__item--on')}
            aria-pressed={active}
            onClick={() => onChange(option.value)}
          >
            {option.label}
            {option.count !== undefined && <span className="ugra-segmented__count">{option.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
