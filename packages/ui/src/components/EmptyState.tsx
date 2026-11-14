import type { JSX, ReactNode } from 'react';
import { cx } from '../cx';

export interface EmptyStateProps {
  title: string;
  hint?: string;
  icon?: ReactNode;
  /** Кнопки или ссылки под подсказкой. */
  children?: ReactNode;
  className?: string;
}

/** Пустое состояние: заголовок, объяснение и действие — одинаково на всех экранах. */
export function EmptyState({ title, hint, icon, children, className }: EmptyStateProps): JSX.Element {
  return (
    <section className={cx('ugra-empty', className)} role="status">
      {icon && (
        <span className="ugra-empty__icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <h2 className="ugra-empty__title">{title}</h2>
      {hint && <p className="ugra-empty__hint">{hint}</p>}
      {children && <div className="ugra-empty__actions">{children}</div>}
    </section>
  );
}
