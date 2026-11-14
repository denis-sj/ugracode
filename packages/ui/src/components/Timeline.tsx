import type { JSX } from 'react';
import { cx } from '../cx';
import type { BadgeTone } from '../types';

export interface TimelineItem {
  id: string;
  title: string;
  description?: string;
  /** Готовая подпись времени — компонент не форматирует даты сам. */
  at?: string;
  tone?: BadgeTone;
}

export interface TimelineProps {
  items: readonly TimelineItem[];
  empty?: string;
  className?: string;
}

const ALLOWED_TONES: ReadonlySet<string> = new Set(['accent', 'ok', 'warn', 'danger', 'muted', 'neutral', 'info']);

export function Timeline({ items, empty = 'Событий пока нет', className }: TimelineProps): JSX.Element {
  if (items.length === 0) {
    return <p className={cx('ugra-muted', className)}>{empty}</p>;
  }
  return (
    <ol className={cx('ugra-timeline', className)}>
      {items.map((item, index) => {
        const tone = item.tone && ALLOWED_TONES.has(item.tone) ? item.tone : 'neutral';
        return (
          <li
            key={item.id}
            className={cx('ugra-timeline__item', `ugra-timeline__item--${tone}`)}
            style={{ animationDelay: `calc(var(--dur-fast) * ${index})` }}
          >
            <span className="ugra-timeline__dot" aria-hidden="true" />
            <div className="ugra-timeline__title">{item.title}</div>
            {item.description && <div className="ugra-timeline__desc">{item.description}</div>}
            {item.at && <div className="ugra-timeline__time">{item.at}</div>}
          </li>
        );
      })}
    </ol>
  );
}
