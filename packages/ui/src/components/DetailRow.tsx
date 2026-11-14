import type { JSX, ReactNode } from 'react';
import { cx } from '../cx';

export type DetailTone = 'default' | 'ok' | 'warn' | 'danger' | 'accent' | 'muted';

export interface DetailRowProps {
  label: string;
  value: ReactNode;
  /** Пояснение под значением: происхождение, уверенность, срок. */
  hint?: ReactNode;
  tone?: DetailTone;
  /** `stack` — подпись над значением (стикер), `row` — в строке (итог проверки). */
  layout?: 'row' | 'stack';
  className?: string;
}

/** Пара «подпись → значение» для стикера, итога заявки и шапки аварии. */
export function DetailRow({
  label,
  value,
  hint,
  tone = 'default',
  layout = 'row',
  className,
}: DetailRowProps): JSX.Element {
  return (
    <div className={cx('ugra-detail', layout === 'stack' && 'ugra-detail--stack', className)}>
      <span className="ugra-detail__label">{label}</span>
      <span className={cx('ugra-detail__value', `ugra-detail__value--${tone}`)}>
        <span className="ugra-detail__value-text">{value}</span>
        {hint && <span className="ugra-detail__hint">{hint}</span>}
      </span>
    </div>
  );
}
