import type { JSX } from 'react';
import { cx } from '../cx';
import { clamp01, confidenceTone, formatConfidence } from '../format';

export interface ConfidenceBarProps {
  /** Уверенность модели 0…1. */
  value: number;
  /** Порог «на проверку» (из настроек); по умолчанию 0,75. */
  threshold?: number;
  label?: string;
  compact?: boolean;
  className?: string;
}

/** Шкала уверенности ИИ: цвет и подпись считаются из значения. */
export function ConfidenceBar({
  value,
  threshold = 0.75,
  label = 'Уверенность',
  compact = false,
  className,
}: ConfidenceBarProps): JSX.Element {
  const tone = confidenceTone(value, threshold);
  const percent = Math.round(clamp01(value) * 100);
  return (
    <div
      className={cx('ugra-confidence', `ugra-confidence--${tone}`, compact && 'ugra-confidence--compact', className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-label={label}
    >
      <div className="ugra-confidence__head">
        <span>{label}</span>
        <span className="ugra-confidence__value">{formatConfidence(value)}</span>
      </div>
      <div className="ugra-confidence__track">
        <div className="ugra-confidence__fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
