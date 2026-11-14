import type { JSX } from 'react';
import type { OverviewPrioritySlice, OverviewSlice } from '../contracts';
import { formatCount } from './format';

export interface PriorityCardsProps {
  /** Срезы приоритетов с рядом по дням. */
  slices: readonly OverviewPrioritySlice[];
  /** Те же срезы за прошлый период — для строки «+N к прошлому». */
  previous: readonly OverviewSlice[];
  periodDays: number;
}

/** Цвет приоритета — только токеном: карточка подкрашивается им, а не заливкой-градиентом. */
const PRIORITY_VAR: Record<string, string> = {
  emergency: 'var(--color-priority-emergency)',
  critical: 'var(--color-priority-critical)',
  high: 'var(--color-priority-high)',
  medium: 'var(--color-priority-medium)',
  low: 'var(--color-priority-low)',
};

function deltaText(count: number, previousCount: number | undefined): string {
  if (previousCount === undefined) return '';
  const delta = count - previousCount;
  if (delta === 0) return 'как в прошлом';
  return `${delta > 0 ? '+' : '−'}${Math.abs(delta)} к прошлому`;
}

/**
 * Пять стеклянных карточек приоритетов (макет D2): число, изменение к прошлому периоду,
 * доля от всех, мини-столбцы по дням и лёгкий оттенок цвета приоритета.
 */
export function PriorityCards({ slices, previous, periodDays }: PriorityCardsProps): JSX.Element {
  const total = slices.reduce((sum, slice) => sum + slice.count, 0);
  const previousById = new Map(previous.map((slice) => [slice.key, slice.count]));
  const maxDaily = Math.max(1, ...slices.flatMap((slice) => slice.daily));

  return (
    <section className="rd-prio" aria-label="Обращения по приоритетам">
      {slices.map((slice) => {
        const share = total === 0 ? 0 : Math.round((slice.count / total) * 100);
        const delta = deltaText(slice.count, previousById.get(slice.key));
        return (
          <article
            className="rd-pri"
            key={slice.key}
            data-reveal
            style={{ '--pri': PRIORITY_VAR[slice.key] ?? 'var(--color-text-dim)' } as React.CSSProperties}
          >
            <span className="rd-pri__label">
              <i className="rd-dot" aria-hidden="true" />
              {slice.label}
            </span>
            <span className="rd-pri__num">{formatCount(slice.count)}</span>
            {delta !== '' && <span className="rd-pri__delta">{delta}</span>}
            <span className="rd-track" aria-hidden="true">
              <i style={{ width: `${share}%` }} />
            </span>
            <span className="rd-pri__share">{share}% всех</span>
            <span className="rd-pri__bars" aria-hidden="true">
              {Array.from({ length: periodDays }, (_, day) => {
                const value = slice.daily[day] ?? 0;
                return (
                  <i
                    key={day}
                    data-empty={value === 0 ? '1' : undefined}
                    style={{ height: `${Math.max(3, Math.round((value / maxDaily) * 100))}%` }}
                  />
                );
              })}
            </span>
          </article>
        );
      })}
    </section>
  );
}
