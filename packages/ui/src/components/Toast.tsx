import type { JSX } from 'react';
import { useEffect, useRef } from 'react';
import { cx } from '../cx';

export type ToastTone = 'danger' | 'warn' | 'ok' | 'info';

export interface ToastProps {
  /** `null` — тоста нет. */
  message: string | null;
  tone?: ToastTone;
  onClose?: () => void;
  /** Через сколько миллисекунд закрыть сам; 0 — не закрывать. */
  timeout?: number;
  className?: string;
}

/** Короткое сообщение об ошибке действия: плашка внизу экрана, закрывается сама. */
export function Toast({
  message,
  tone = 'danger',
  onClose,
  timeout = 4000,
  className,
}: ToastProps): JSX.Element | null {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (message === null || timeout <= 0) return undefined;
    const timer = window.setTimeout(() => onCloseRef.current?.(), timeout);
    return () => window.clearTimeout(timer);
  }, [message, timeout]);

  if (message === null || message.trim() === '') return null;

  return (
    <div className={cx('ugra-toast', `ugra-toast--${tone}`, className)} role={tone === 'danger' ? 'alert' : 'status'}>
      <span className="ugra-toast__text">{message}</span>
      {onClose && (
        <button type="button" className="ugra-toast__close" aria-label="Закрыть сообщение" onClick={onClose}>
          ×
        </button>
      )}
    </div>
  );
}
