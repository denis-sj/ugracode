import type { FieldOrigin } from '@ugra/contracts';
import type { JSX, ReactNode } from 'react';
import { cx } from '../cx';
import { ConfidenceBar } from './ConfidenceBar';
import { OriginBadge } from './OriginBadge';
import { QuoteChip } from './QuoteChip';

export interface FieldRowProps {
  label: string;
  value?: string | number | null;
  confidence?: number | null;
  threshold?: number;
  quote?: string | null;
  quoteSource?: string;
  origin?: FieldOrigin;
  needsReview?: boolean;
  emptyText?: string;
  /** Подсветка «поле только что появилось» (после перелёта из чата). */
  reveal?: boolean;
  aside?: ReactNode;
  children?: ReactNode;
  fieldKey?: string;
  rowRef?: (element: HTMLDivElement | null) => void;
  className?: string;
}

export function FieldRow({
  label,
  value,
  confidence,
  threshold = 0.75,
  quote,
  quoteSource,
  origin,
  needsReview = false,
  emptyText = 'не заполнено',
  reveal = false,
  aside,
  children,
  fieldKey,
  rowRef,
  className,
}: FieldRowProps): JSX.Element {
  const hasValue = value !== null && value !== undefined && `${value}`.trim() !== '';
  return (
    <div
      ref={rowRef}
      data-field-key={fieldKey}
      className={cx(
        'ugra-field',
        needsReview && 'ugra-field--needs-review',
        !hasValue && 'ugra-field--empty',
        reveal && 'ugra-field--new',
        className,
      )}
    >
      <div className="ugra-field__head">
        <span className="ugra-field__label">{label}</span>
        <span className="ugra-field__aside">{aside}</span>
      </div>
      <div className={cx('ugra-field__value', !hasValue && 'ugra-field__value--empty')}>
        {hasValue ? String(value) : emptyText}
      </div>
      {children}
      {(typeof confidence === 'number' || quote || origin || needsReview) && (
        <div className="ugra-field__meta">
          {typeof confidence === 'number' && (
            <ConfidenceBar value={confidence} threshold={threshold} label="ИИ" compact />
          )}
          {origin && <OriginBadge origin={origin} />}
          {needsReview && <span className="ugra-badge ugra-badge--warn">на проверку</span>}
          {quote && <QuoteChip text={quote} sourceLabel={quoteSource} />}
        </div>
      )}
    </div>
  );
}
