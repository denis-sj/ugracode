import type { JSX, ReactNode } from 'react';
import { cx } from '../cx';
import type { BadgeTone } from '../types';

export interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  /** Пульсирующая точка — «живой» статус. */
  dot?: boolean;
  className?: string;
  title?: string;
}

export function Badge({ children, tone = 'neutral', dot = false, className, title }: BadgeProps): JSX.Element {
  return (
    <span className={cx('ugra-badge', `ugra-badge--${tone}`, className)} title={title}>
      {dot && <span className="ugra-badge__dot" aria-hidden="true" />}
      {children}
    </span>
  );
}
