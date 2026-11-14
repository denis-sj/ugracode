import type { JSX, ReactNode } from 'react';
import { useEffect, useId, useRef } from 'react';
import { cx } from '../cx';

export type ModalTone = 'default' | 'ok' | 'danger';

export interface ModalProps {
  open: boolean;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  closeLabel?: string;
  tone?: ModalTone;
  className?: string;
}

/**
 * Окно поверх страницы (например, «Заявка назначена» после подтверждения).
 * Закрывается Escape, кликом по затемнению и крестиком; фокус уходит в панель.
 */
export function Modal({
  open,
  title,
  children,
  footer,
  onClose,
  closeLabel = 'Закрыть',
  tone = 'default',
  className,
}: ModalProps): JSX.Element | null {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div
      className="ugra-modal"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={cx('ugra-modal__panel', `ugra-modal__panel--${tone}`, className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
      >
        <div className="ugra-modal__head">
          {title && (
            <h2 className="ugra-modal__title" id={titleId}>
              {title}
            </h2>
          )}
          <button type="button" className="ugra-modal__close" aria-label={closeLabel} onClick={onClose}>
            ×
          </button>
        </div>
        <div className="ugra-modal__body">{children}</div>
        {footer && <div className="ugra-modal__footer">{footer}</div>}
      </div>
    </div>
  );
}
