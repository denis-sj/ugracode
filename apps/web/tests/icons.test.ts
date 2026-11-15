import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ICON_NAMES, Icon } from '@ugra/ui';
import { TabIcon } from '../src/shell/TabIcon';
import { tabsForRole } from '../src/shell/lib';
import type { TabIconName } from '../src/shell/TabIcon';

/** Двухтоновые иконки шапки: набор полный, слой заливки есть у каждого рисунка. */

const TAB_ICONS: TabIconName[] = [
  'chat',
  'tickets',
  'queue',
  'incidents',
  'journal',
  'executors',
  'tasks',
  'kb',
  'measure',
  'dashboard',
  'reports',
  'quality',
];

describe('Icon', () => {
  it('содержит все имена, которые просят вкладки и док', () => {
    for (const name of [...TAB_ICONS, 'moon', 'sun', 'bell'] as const) {
      expect(ICON_NAMES, name).toContain(name);
    }
  });

  it('рисует заливку `.ugra-icon__du` и контур одним цветом', () => {
    const markup = renderToStaticMarkup(createElement(Icon, { name: 'bell', size: 20 }));
    expect(markup).toContain('ugra-icon__du');
    expect(markup).toContain('width="20"');
    expect(markup).toContain('stroke-width="1.7"');
    expect(markup).toContain('aria-hidden="true"');
  });

  it('размер по умолчанию — 20 px, как круглая кнопка дока', () => {
    expect(renderToStaticMarkup(createElement(Icon, { name: 'moon' }))).toContain('width="20"');
  });
});

describe('TabIcon', () => {
  it('каждая вкладка каждой роли получает свой двухтоновый рисунок', () => {
    for (const role of ['applicant', 'dispatcher', 'engineer', 'manager', 'admin'] as const) {
      for (const tab of tabsForRole(role)) {
        const markup = renderToStaticMarkup(createElement(TabIcon, { name: tab.icon }));
        expect(markup, `${role} ${tab.path}`).toContain('ugra-icon__du');
        expect(markup, `${role} ${tab.path}`).toContain('shell-tab__icon');
        expect(markup, `${role} ${tab.path}`).toContain('width="22"');
      }
    }
  });

  it('у базы знаний иконка книги', () => {
    const kb = tabsForRole('engineer').find((tab) => tab.path === '/knowledge');
    expect(kb?.icon).toBe('kb');
  });
});
