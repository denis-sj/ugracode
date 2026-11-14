import type { JSX } from 'react';
import { cx } from './cx';

/**
 * Двухтоновые иконки интерфейса (эталон — `sources/kit.js` из пакета макетов владельца):
 * полупрозрачная заливка `.ugra-icon__du` (opacity 0.22, у активной вкладки 0.38) плюс контур.
 * Рисунки перенесены из макета один в один; инлайновый SVG — демо работает без сети.
 *
 * Правило: иконка живёт здесь, а не в экране. Экран передаёт имя и размер.
 */
export type IconName =
  | 'chat'
  | 'tickets'
  | 'queue'
  | 'incidents'
  | 'journal'
  | 'executors'
  | 'measure'
  | 'dashboard'
  | 'reports'
  | 'quality'
  | 'tasks'
  | 'kb'
  | 'moon'
  | 'sun'
  | 'bell';

/** Заливка двухтонового слоя: тот же контур, только заполненный. */
const DU = 'ugra-icon__du';

/** Общая форма контура: обводка идёт от самого `<svg>`, заливка — у слоя `.du`. */
const ICONS: Record<IconName, JSX.Element> = {
  chat: (
    <>
      <path
        className={DU}
        d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-5 3.5V17H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"
      />
      <path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-5 3.5V17H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM8 10h.01M12 10h.01M16 10h.01" />
    </>
  ),
  tickets: (
    <>
      <path
        className={DU}
        d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2.5a2.5 2.5 0 0 0 0 5V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2.5a2.5 2.5 0 0 0 0-5z"
      />
      <path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2.5a2.5 2.5 0 0 0 0 5V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2.5a2.5 2.5 0 0 0 0-5zM15 5v14" />
    </>
  ),
  queue: (
    <>
      <rect className={DU} x="4" y="9" width="16" height="11" rx="2.5" />
      <path d="M7 4.5h10M5.5 7h13" />
      <rect x="4" y="9" width="16" height="11" rx="2.5" />
    </>
  ),
  incidents: (
    <>
      <path
        className={DU}
        d="M10.3 4.2a2 2 0 0 1 3.4 0l7.4 12.6A2 2 0 0 1 19.4 20H4.6a2 2 0 0 1-1.7-3.2z"
      />
      <path d="M10.3 4.2a2 2 0 0 1 3.4 0l7.4 12.6A2 2 0 0 1 19.4 20H4.6a2 2 0 0 1-1.7-3.2zM12 9.5v4M12 16.5h.01" />
    </>
  ),
  journal: (
    <>
      <circle className={DU} cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2M3.5 12a8.5 8.5 0 1 0 2.5-6M3.5 4.5V8H7" />
    </>
  ),
  executors: (
    <>
      <circle className={DU} cx="9" cy="8" r="3.5" />
      <path className={DU} d="M2.5 19.5c.6-3.4 3.3-5.5 6.5-5.5s5.9 2.1 6.5 5.5z" />
      <path d="M2.5 19.5c.6-3.4 3.3-5.5 6.5-5.5s5.9 2.1 6.5 5.5M15.5 4.8a3.5 3.5 0 0 1 0 6.4M17.5 14.3c2.2.6 3.6 2.4 4 5.2" />
      <circle cx="9" cy="8" r="3.5" />
    </>
  ),
  measure: (
    <>
      <path className={DU} d="M12 3.5h6.5a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H12z" />
      <path d="M5.5 3.5h13a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2zM12 3.5v17M6.5 9.5h3M6.5 13h2M15 9l1 2 2 .5-1.5 1.5.4 2-1.9-1-1.9 1 .4-2L13 11.5l2-.5z" />
    </>
  ),
  dashboard: (
    <>
      <rect className={DU} x="13" y="3.5" width="7.5" height="7.5" rx="2" />
      <path d="M5.5 3.5h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-3a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2zM15 3.5h3.5a2 2 0 0 1 2 2V9a2 2 0 0 1-2 2H15a2 2 0 0 1-2-2V5.5a2 2 0 0 1 2-2zM5.5 13h3a2 2 0 0 1 2 2v3.5a2 2 0 0 1-2 2h-3a2 2 0 0 1-2-2V15a2 2 0 0 1 2-2zM15 13h3.5a2 2 0 0 1 2 2v3.5a2 2 0 0 1-2 2H15a2 2 0 0 1-2-2V15a2 2 0 0 1 2-2z" />
    </>
  ),
  reports: (
    <>
      <path
        className={DU}
        d="M6 3.5h8.5l4 4v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2z"
      />
      <path d="M6 3.5h8.5l4 4v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2zM14 3.5V8h4.5M8 17v-3M11.5 17v-6M15 17v-4" />
    </>
  ),
  quality: (
    <>
      <circle className={DU} cx="12" cy="12" r="5" />
      <path d="M20.5 12A8.5 8.5 0 1 1 12 3.5M17 12a5 5 0 1 1-5-5M12 12l7-7M16 5h3v3" />
    </>
  ),
  tasks: (
    <>
      <rect className={DU} x="4" y="3.5" width="16" height="17" rx="2.5" />
      <path d="M6.5 3.5h11a2.5 2.5 0 0 1 2.5 2.5v12a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18V6a2.5 2.5 0 0 1 2.5-2.5zM8 9l1.5 1.5L12 8M8 15l1.5 1.5L12 14M14.5 9.5H17M14.5 15.5H17" />
    </>
  ),
  kb: (
    <>
      <path className={DU} d="M12 6.5C10 5 7 4.5 4 5v13.5c3-.5 6 0 8 1.5z" />
      <path d="M12 6.5C10 5 7 4.5 4 5v13.5c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5V5c-3-.5-6 0-8 1.5zM12 6.5V20" />
    </>
  ),
  moon: (
    <>
      <path className={DU} d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
    </>
  ),
  sun: (
    <>
      <circle className={DU} cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </>
  ),
  bell: (
    <>
      <path className={DU} d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z" />
      <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15zM9.8 21a2.4 2.4 0 0 0 4.4 0" />
    </>
  ),
};

export interface IconProps {
  name: IconName;
  /** Сторона квадрата в px: 22 в вкладках шапки, 20 в круглых кнопках дока. */
  size?: number;
  className?: string;
}

/** Двухтоновая иконка: заливка `.du` + контур одним цветом `currentColor`. */
export function Icon({ name, size = 20, className }: IconProps): JSX.Element {
  return (
    <svg
      className={cx('ugra-icon', className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  );
}

/** Все имена иконок — для теста полноты набора. */
export const ICON_NAMES = Object.keys(ICONS) as IconName[];
