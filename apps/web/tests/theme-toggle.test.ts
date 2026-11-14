// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { THEME_ATTRIBUTE, THEME_STORAGE_KEY, ThemeToggle, readStoredTheme } from '@ugra/ui';

/** Переключатель темы: разметка, aria-pressed и сохранение выбора. */

beforeEach(() => {
  document.documentElement.removeAttribute(THEME_ATTRIBUTE);
  window.localStorage.clear();
});

afterEach(() => {
  document.body.innerHTML = '';
  document.documentElement.removeAttribute(THEME_ATTRIBUTE);
  window.localStorage.clear();
});

describe('ThemeToggle', () => {
  it('светлая тема по умолчанию: луна и aria-pressed=false', () => {
    const markup = renderToStaticMarkup(createElement(ThemeToggle));
    expect(markup).toContain('aria-label="Тёмная тема"');
    expect(markup).toContain('aria-pressed="false"');
    expect(markup).toContain('ugra-liquid');
  });

  it('тёмная тема: aria-pressed=true и иконка солнца', () => {
    document.documentElement.setAttribute(THEME_ATTRIBUTE, 'dark');
    const markup = renderToStaticMarkup(createElement(ThemeToggle));
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('<circle cx="12" cy="12" r="4.2"');
  });

  it('клик переключает тему, сохраняет выбор и обновляет aria-pressed', async () => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(createElement(ThemeToggle));
    });

    const button = host.querySelector('button');
    expect(button).not.toBeNull();
    expect(button?.getAttribute('aria-pressed')).toBe('false');

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe('dark');
    expect(readStoredTheme(window.localStorage)).toBe('dark');
    expect(button?.getAttribute('aria-pressed')).toBe('true');

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(document.documentElement.hasAttribute(THEME_ATTRIBUTE)).toBe(false);
    expect(readStoredTheme(window.localStorage)).toBe('light');
    expect(button?.getAttribute('aria-pressed')).toBe('false');

    await act(async () => {
      root.unmount();
    });
  });

  it('битый localStorage не мешает переключению', async () => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    window.localStorage.setItem(THEME_STORAGE_KEY, 'мусор');
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(createElement(ThemeToggle));
    });

    expect(host.querySelector('button')?.getAttribute('aria-pressed')).toBe('false');

    await act(async () => {
      root.unmount();
    });
  });
});
