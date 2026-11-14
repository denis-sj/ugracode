import type { JSX } from 'react';
import { useEffect, useRef } from 'react';
import { countUp } from '../animations';
import { cx } from '../cx';

export type StatTone = 'default' | 'accent' | 'ok' | 'warn' | 'danger';

export interface StatTileProps {
  label: string;
  value: string | number;
  hint?: string;
  tone?: StatTone;
  icon?: string;
  className?: string;
  /** Анимировать число при появлении. */
  animate?: boolean;
}

/** Плитка показателя: цифра «набегает» через countUp из токенов длительности. */
export function StatTile({
  label,
  value,
  hint,
  tone = 'default',
  icon,
  className,
  animate = true,
}: StatTileProps): JSX.Element {
  const valueRef = useRef<HTMLSpanElement | null>(null);
  const previousRef = useRef(0);
  const numeric = typeof value === 'number' ? value : Number(value);

  useEffect(() => {
    if (!animate || !Number.isFinite(numeric) || !valueRef.current) return undefined;
    const from = previousRef.current;
    previousRef.current = numeric;
    const cancel = countUp(valueRef.current, numeric, {
      from,
      format: (next) => (Number.isInteger(numeric) ? String(Math.round(next)) : next.toFixed(1)),
    });
    return cancel;
  }, [animate, numeric]);

  return (
    <div className={cx('ugra-stat', `ugra-stat--${tone}`, className)}>
      {icon && (
        <span className="ugra-stat__icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <span className="ugra-stat__label">{label}</span>
      <span className="ugra-stat__value" ref={valueRef}>
        {value}
      </span>
      {hint && <span className="ugra-stat__hint">{hint}</span>}
    </div>
  );
}
