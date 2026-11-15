import type { JSX, ReactNode } from 'react';
import type { TabIconName } from './lib';

/** Контуры иконок вкладок (вариант E шапки): 24×24, обводка currentColor. */
const PATHS: Record<TabIconName, ReactNode> = {
  queue: <path d="M4 6h16M4 12h16M4 18h10" />,
  incidents: (
    <>
      <path d="M12 4l9 16H3z" />
      <path d="M12 10v4M12 17h.01" />
    </>
  ),
  journal: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l3 2" />
    </>
  ),
  phone: (
    <path d="M7.2 4.2c.6-.4 1.4-.2 1.8.4l1.6 2.5c.3.5.3 1.2-.1 1.7l-.9 1.1c-.2.3-.2.6 0 .9 1.1 1.8 2.6 3.3 4.4 4.4.3.2.6.2.9 0l1.1-.9c.5-.4 1.2-.4 1.7-.1l2.5 1.6c.6.4.8 1.2.4 1.8l-1.1 1.7c-.4.7-1.2 1.1-2 1-6.2-.9-10.8-5.5-11.7-11.7-.1-.8.3-1.6 1-2l1.4-.4z" />
  ),
  executors: (
    <>
      <circle cx="9" cy="9" r="3.5" />
      <path d="M3 19c.8-3 3.2-4.5 6-4.5s5.2 1.5 6 4.5M16 6.5a3 3 0 0 1 0 5.5M18 14.8c1.5.6 2.5 2 3 4.2" />
    </>
  ),
  chat: <path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4 3.5V16H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />,
  tickets: (
    <>
      <rect x="5" y="3.5" width="14" height="17" rx="2" />
      <path d="M9 8.5h6M9 12h6M9 15.5h4" />
    </>
  ),
  tasks: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M8.5 12.2l2.4 2.3 4.6-4.8" />
    </>
  ),
  knowledge: (
    <>
      <path d="M4 5.5C6.5 4.5 9.5 4.5 12 6c2.5-1.5 5.5-1.5 8-.5v13c-2.5-1-5.5-1-8 .5-2.5-1.5-5.5-1.5-8-.5z" />
      <path d="M12 6v13" />
    </>
  ),
  dashboard: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="4" rx="1.5" />
      <rect x="13" y="10" width="7" height="10" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
    </>
  ),
  reports: (
    <>
      <path d="M4 20h16" />
      <path d="M7 16v-5M12 16V7M17 16v-8" />
    </>
  ),
  quality: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
      <path d="M12 12h.01" />
    </>
  ),
};

export function TabIcon({ name }: { name: TabIconName }): JSX.Element {
  return (
    <svg
      className="shell-tab__icon"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
