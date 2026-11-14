import type { JSX } from 'react';
import { cx } from '../cx';

export interface ChecklistItem {
  id: string;
  label: string;
  hint?: string;
  done?: boolean;
}

export interface ChecklistProps {
  items: readonly ChecklistItem[];
  /** Если передан — пункты кликабельны и работают как чекбоксы. */
  onToggle?: (id: string) => void;
  label?: string;
  className?: string;
}

/** Чек-лист регламента и диагностики: отметки, пояснения, счётчик — у родителя. */
export function Checklist({ items, onToggle, label = 'Чек-лист', className }: ChecklistProps): JSX.Element {
  return (
    <ul className={cx('ugra-checklist', className)} aria-label={label}>
      {items.map((item) => {
        const markClass = cx('ugra-checklist__box', item.done && 'ugra-checklist__box--done');
        const content = (
          <>
            <span className={markClass} aria-hidden="true">
              {item.done ? '✓' : ''}
            </span>
            <span className="ugra-checklist__text">
              <span className={cx('ugra-checklist__label', item.done && 'ugra-checklist__label--done')}>
                {item.label}
              </span>
              {item.hint && <span className="ugra-checklist__hint">{item.hint}</span>}
            </span>
          </>
        );
        return (
          <li key={item.id} className="ugra-checklist__item">
            {onToggle ? (
              <button
                type="button"
                className="ugra-checklist__button"
                role="checkbox"
                aria-checked={item.done === true}
                onClick={() => onToggle(item.id)}
              >
                {content}
              </button>
            ) : (
              <div className="ugra-checklist__static">{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
