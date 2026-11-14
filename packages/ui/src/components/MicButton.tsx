import type { JSX } from 'react';
import { cx } from '../cx';

export interface MicButtonProps {
  /** Нажатие на микрофон. Компонент ничего не записывает — запись запускает вызывающий код. */
  onRecord: () => void;
  recording: boolean;
  disabled?: boolean;
  title?: string;
  className?: string;
}

/**
 * Кнопка записи голоса. Сама ничего не пишет в сеть и не держит микрофон:
 * только показывает состояние записи (`recording`) и зовёт `onRecord`.
 */
export function MicButton({
  onRecord,
  recording,
  disabled = false,
  title = 'Записать голосом',
  className,
}: MicButtonProps): JSX.Element {
  return (
    <button
      type="button"
      className={cx('ugra-mic', recording && 'ugra-mic--recording', className)}
      onClick={onRecord}
      disabled={disabled}
      aria-pressed={recording}
      aria-label={recording ? 'Остановить запись' : title}
      title={recording ? 'Остановить запись' : title}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
        <path
          d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}
