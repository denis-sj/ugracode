import type { JSX } from 'react';
import { cx } from '../cx';

export interface QuoteChipProps {
  /** Дословный фрагмент обращения, из которого взято значение. */
  text: string | null | undefined;
  sourceLabel?: string;
  className?: string;
}

/** Цитата «почему ИИ так решил»: по наведению и фокусу раскрывается пузырёк с полным фрагментом. */
export function QuoteChip({ text, sourceLabel, className }: QuoteChipProps): JSX.Element | null {
  const quote = text?.trim();
  if (!quote) return null;
  const preview = quote.length > 28 ? `${quote.slice(0, 28)}…` : quote;
  return (
    <button type="button" className={cx('ugra-quote', className)} title={quote} aria-label={`Цитата: ${quote}`}>
      <span aria-hidden="true">❝</span>
      <span className="ugra-quote__text">{preview}</span>
      <span className="ugra-quote__bubble" role="tooltip">
        {quote}
        {sourceLabel && <span className="ugra-quote__source">Источник: {sourceLabel}</span>}
      </span>
    </button>
  );
}
