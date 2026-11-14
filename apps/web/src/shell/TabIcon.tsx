import type { JSX } from 'react';
import { Icon } from '@ugra/ui';
import type { IconName } from '@ugra/ui';

/** Иконки вкладок — из общего набора `@ugra/ui` (рисунки из макета, двухтоновые). */
export type TabIconName = Extract<
  IconName,
  | 'queue'
  | 'incidents'
  | 'journal'
  | 'executors'
  | 'chat'
  | 'tickets'
  | 'tasks'
  | 'kb'
  | 'measure'
  | 'dashboard'
  | 'reports'
  | 'quality'
>;

/** Иконка над подписью вкладки: 22 px, как в шапке из макета. */
export function TabIcon({ name }: { name: TabIconName }): JSX.Element {
  return <Icon name={name} size={22} className="shell-tab__icon" />;
}
