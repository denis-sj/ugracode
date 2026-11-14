import type { JSX } from 'react';
import { cx } from '../cx';

export interface ActionCounterPillProps {
  count: number;
  /** Подпись перед числом; по умолчанию «Ваших действий». */
  label?: string;
  className?: string;
}

/** Плашка «Ваших действий: N» для карточки проверки — цифра для критерия К4. */
export function ActionCounterPill({
  count,
  label = 'Ваших действий',
  className,
}: ActionCounterPillProps): JSX.Element {
  const safe = Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0;
  return (
    <span className={cx('ugra-actions', className)}>
      {label}: <b>{safe}</b>
    </span>
  );
}
