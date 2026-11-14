import type { JSX, ReactNode } from 'react';
import { cx } from '../cx';

export interface ChipProps {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
  title?: string;
  className?: string;
}

/** Компактный фильтр-чип: категория, исполнитель, канал на дашборде и в очереди. */
export function Chip({ children, active = false, onClick, title, className }: ChipProps): JSX.Element {
  if (onClick) {
    return (
      <button
        type="button"
        className={cx('ugra-chip', active && 'ugra-chip--active', className)}
        aria-pressed={active}
        title={title}
        onClick={onClick}
      >
        {children}
      </button>
    );
  }
  return (
    <span className={cx('ugra-chip', active && 'ugra-chip--active', className)} title={title}>
      {children}
    </span>
  );
}
