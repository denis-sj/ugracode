import type { JSX, ReactNode } from 'react';
import { useEffect, useId, useRef } from 'react';
import { expandBody } from '../motion';
import { cx } from '../cx';

export interface StepBlockProps {
  /** Номер шага с единицы. */
  index: number;
  title: string;
  /** Итог шага, когда он свёрнут: «6 полей, 1 ждёт вас». */
  summary?: string;
  open: boolean;
  done?: boolean;
  onToggle: () => void;
  children: ReactNode;
  /** Кнопка «к следующему» внизу открытого блока. */
  footer?: ReactNode;
  className?: string;
}

/** Сворачиваемый шаг проверки заявки (4.4): заголовок с номером/галочкой и итогом. */
export function StepBlock({
  index,
  title,
  summary,
  open,
  done = false,
  onToggle,
  children,
  footer,
  className,
}: StepBlockProps): JSX.Element {
  const bodyId = useId();
  const bodyRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (open) expandBody(bodyRef.current);
  }, [open]);
  return (
    <section className={cx('ugra-step', open && 'ugra-step--open', done && 'ugra-step--done', className)}>
      <button
        type="button"
        className="ugra-step__head"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={onToggle}
      >
        <span className={cx('ugra-step__mark', done && !open && 'ugra-step__mark--done')} aria-hidden="true">
          {done && !open ? '✓' : index}
        </span>
        <span className="ugra-step__title">{title}</span>
        {!open && summary && <span className="ugra-step__summary">{summary}</span>}
        <span className="ugra-step__chevron" aria-hidden="true">
          {open ? '−' : '+'}
        </span>
      </button>
      {open && (
        <div className="ugra-step__body" id={bodyId} ref={bodyRef}>
          {children}
          {footer && <div className="ugra-step__footer">{footer}</div>}
        </div>
      )}
    </section>
  );
}
