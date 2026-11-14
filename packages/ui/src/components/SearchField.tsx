import type { JSX } from 'react';
import { cx } from '../cx';

export interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Подпись для скринридера. */
  label?: string;
  className?: string;
  autoFocus?: boolean;
}

/** Поле поиска в стекле: лупа, прозрачный ввод, подпись только для скринридера. */
export function SearchField({
  value,
  onChange,
  placeholder = 'Номер, кабинет, текст',
  label = 'Поиск',
  className,
  autoFocus = false,
}: SearchFieldProps): JSX.Element {
  return (
    <label className={cx('ugra-search', className)}>
      <span className="ugra-sr-only">{label}</span>
      <svg
        className="ugra-search__icon"
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="6.5" />
        <path d="M20 20l-4-4" />
      </svg>
      <input
        className="ugra-search__input"
        type="search"
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
