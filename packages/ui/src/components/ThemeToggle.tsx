import type { JSX } from 'react';
import { cx } from '../cx';
import { useTheme } from '../theme';

export interface ThemeToggleProps {
  /** Плавающая кнопка в правом верхнем углу — для экрана входа, где нет шапки. */
  floating?: boolean;
  className?: string;
}

/** Луна — включить тёмную, солнце — вернуться к светлой (дизайн 2.4). */
function MoonIcon(): JSX.Element {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 13.2A8 8 0 0 1 10.8 4a8.4 8.4 0 1 0 9.2 9.2z" />
    </svg>
  );
}

function SunIcon(): JSX.Element {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" />
    </svg>
  );
}

/**
 * Переключатель тёмной темы: круглая стеклянная кнопка 44 px.
 * Тема ставится на `<html>`, поэтому переключатель не зависит от остальных компонентов.
 */
export function ThemeToggle({ floating = false, className }: ThemeToggleProps): JSX.Element {
  const { theme, toggle } = useTheme();
  const dark = theme === 'dark';

  return (
    <button
      type="button"
      className={cx('ugra-theme-btn', 'ugra-liquid', floating && 'ugra-theme-btn--floating', className)}
      aria-label="Тёмная тема"
      aria-pressed={dark}
      title={dark ? 'Светлая тема' : 'Тёмная тема'}
      onClick={toggle}
    >
      <span className="ugra-theme-btn__icon">{dark ? <SunIcon /> : <MoonIcon />}</span>
    </button>
  );
}
