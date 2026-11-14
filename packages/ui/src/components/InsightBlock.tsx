import type { JSX, ReactNode } from 'react';
import { cx } from '../cx';

export type InsightKind = 'meaning' | 'action';

export interface InsightBlockProps {
  kind?: InsightKind;
  /** По умолчанию «Что это значит» / «Что сделать». */
  title?: string;
  children: ReactNode;
  className?: string;
}

const DEFAULT_TITLE: Record<InsightKind, string> = {
  meaning: 'Что это значит',
  action: 'Что сделать',
};

/** Блок вывода под графиком: факт простыми словами или конкретная рекомендация. */
export function InsightBlock({ kind = 'meaning', title, children, className }: InsightBlockProps): JSX.Element {
  return (
    <div className={cx('ugra-insight', kind === 'action' && 'ugra-insight--action', className)}>
      <div className="ugra-insight__title">{title ?? DEFAULT_TITLE[kind]}</div>
      <div className="ugra-insight__text">{children}</div>
    </div>
  );
}
