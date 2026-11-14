/**
 * Тема интерфейса: светлая — по умолчанию, тёмная — второй режим (дизайн 2.4).
 *
 * Тема живёт атрибутом `data-theme="dark"` на `<html>`: CSS-токены переключаются сами,
 * компоненты о теме не знают. Выбор запоминается в `localStorage`; системную тему
 * (`prefers-color-scheme`) не используем — тёмная включается только вручную.
 *
 * Любая ошибка хранилища (приватный режим, выключенное хранилище) не ломает экран:
 * тема просто не сохранится. Это же правило — для inline-скрипта в `index.html`.
 */

import { useCallback, useEffect, useState } from 'react';

export const THEME_ATTRIBUTE = 'data-theme';
export const THEME_STORAGE_KEY = 'ugra.theme';

export type Theme = 'light' | 'dark';

/** Минимум хранилища: в тестах подставляется объект, в браузере — `localStorage`. */
export type ThemeStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Всё, что не `dark`, — светлая тема: мусор в хранилище не должен включать тёмную. */
export function normalizeTheme(value: unknown): Theme {
  return value === 'dark' ? 'dark' : 'light';
}

export function toggleTheme(theme: Theme): Theme {
  return theme === 'dark' ? 'light' : 'dark';
}

function safeStorage(): ThemeStorage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function rootElement(): Element | null {
  try {
    return typeof document === 'undefined' ? null : document.documentElement;
  } catch {
    return null;
  }
}

/** Сохранённый выбор; пустое или битое значение — светлая тема. */
export function readStoredTheme(storage: ThemeStorage | null = safeStorage()): Theme {
  if (!storage) return 'light';
  try {
    return normalizeTheme(storage.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'light';
  }
}

/** Записать выбор. `false` — браузер не дал сохранить, интерфейс работает дальше. */
export function saveTheme(theme: Theme, storage: ThemeStorage | null = safeStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(THEME_STORAGE_KEY, theme);
    return true;
  } catch {
    return false;
  }
}

/** Тема из атрибута; `null` — атрибута нет или он чужой. */
export function readThemeAttribute(root: Element | null = rootElement()): Theme | null {
  if (!root) return null;
  try {
    const value = root.getAttribute(THEME_ATTRIBUTE);
    return value === 'dark' || value === 'light' ? value : null;
  } catch {
    return null;
  }
}

/** Поставить тему на корень: тёмная — атрибутом, светлая — его отсутствием. */
export function applyTheme(theme: Theme, root: Element | null = rootElement()): void {
  if (!root) return;
  try {
    if (theme === 'dark') root.setAttribute(THEME_ATTRIBUTE, 'dark');
    else root.removeAttribute(THEME_ATTRIBUTE);
  } catch {
    // Документ недоступен (тест без DOM, ранний вызов) — красить нечего.
  }
}

/**
 * Тема на старте. Атрибут важнее хранилища: inline-скрипт в `<head>` уже поставил
 * его из `localStorage` до первого рендера, и React не должен вернуть светлую.
 */
export function initialTheme(
  root: Element | null = rootElement(),
  storage: ThemeStorage | null = safeStorage(),
): Theme {
  return readThemeAttribute(root) ?? readStoredTheme(storage);
}

/** Состояние переключателя: тема + переключение с записью в хранилище. */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(() => initialTheme());

  useEffect(() => {
    applyTheme(theme);
    saveTheme(theme);
  }, [theme]);

  const toggle = useCallback(() => setTheme(toggleTheme), []);

  return { theme, toggle };
}
