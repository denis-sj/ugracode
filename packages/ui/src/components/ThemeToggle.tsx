import type { JSX } from 'react';
import { cx } from '../cx';
import { Icon } from '../icons';
import { useTheme } from '../theme';

export interface ThemeToggleProps {
  /** Плавающая кнопка в правом верхнем углу — для экрана входа, где нет шапки. */
  floating?: boolean;
  className?: string;
}

/**
 * Переключатель тёмной темы: круглая стеклянная кнопка.
 * Луна — включить тёмную, солнце — вернуться к светлой (дизайн 2.4).
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
      <span className="ugra-theme-btn__icon">
        <Icon name={dark ? 'sun' : 'moon'} />
      </span>
    </button>
  );
}
