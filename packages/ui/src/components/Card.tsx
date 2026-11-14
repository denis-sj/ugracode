import type { JSX, ReactNode } from 'react';
import { cx } from '../cx';

export type CardTone = 'default' | 'accent' | 'ok' | 'warn' | 'danger';

export interface CardProps {
  children: ReactNode;
  className?: string;
  tone?: CardTone;
  padded?: boolean;
  glass?: boolean;
  hero?: boolean;
  interactive?: boolean;
  as?: 'section' | 'article' | 'div' | 'aside';
}

const TONE_CLASS: Record<CardTone, string> = {
  default: '',
  accent: 'ugra-card--accent',
  ok: 'ugra-card--ok',
  warn: 'ugra-card--warn',
  danger: 'ugra-card--danger',
};

/** Базовая карточка: единственный контейнер поверхностей в интерфейсе. */
export function Card({
  children,
  className,
  tone = 'default',
  padded = true,
  glass = false,
  hero = false,
  interactive = false,
  as: Tag = 'section',
}: CardProps): JSX.Element {
  return (
    <Tag
      className={cx(
        'ugra-card',
        padded && 'ugra-card--padded',
        glass && 'ugra-card--glass',
        hero && 'ugra-card--hero',
        interactive && 'ugra-card--interactive',
        TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </Tag>
  );
}
