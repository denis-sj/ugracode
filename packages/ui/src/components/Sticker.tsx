import type { JSX, ReactNode } from 'react';
import { cx } from '../cx';

export interface StickerProps {
  children: ReactNode;
  /** Подпись панели для скринридера. */
  label?: string;
  tone?: 'default' | 'danger';
  className?: string;
}

/** Стеклянный «стикер»: превью заявки в очереди, карточка рядом с чатом. */
export function Sticker({ children, label, tone = 'default', className }: StickerProps): JSX.Element {
  return (
    <aside
      className={cx('ugra-sticker', tone === 'danger' && 'ugra-sticker--danger', className)}
      aria-label={label}
    >
      {children}
    </aside>
  );
}
