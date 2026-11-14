// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  THEME_ATTRIBUTE,
  THEME_STORAGE_KEY,
  applyTheme,
  initialTheme,
  normalizeTheme,
  readStoredTheme,
  readThemeAttribute,
  saveTheme,
  toggleTheme,
} from '../src/theme';
import type { ThemeStorage } from '../src/theme';

interface FakeStorageOptions {
  throwOnRead?: boolean;
  throwOnWrite?: boolean;
}

function fakeStorage(
  initial: Record<string, string> = {},
  options: FakeStorageOptions = {},
): ThemeStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem(key: string): string | null {
      if (options.throwOnRead) throw new Error('storage disabled');
      return Object.prototype.hasOwnProperty.call(data, key) ? (data[key] ?? null) : null;
    },
    setItem(key: string, value: string): void {
      if (options.throwOnWrite) throw new Error('quota exceeded');
      data[key] = value;
    },
  };
}

function html(): HTMLElement {
  const root = document.documentElement;
  root.removeAttribute(THEME_ATTRIBUTE);
  return root;
}

beforeEach(() => {
  document.documentElement.removeAttribute(THEME_ATTRIBUTE);
  try {
    window.localStorage.clear();
  } catch {
    // Хранилище недоступно — тесты это отдельно проверяют.
  }
});

afterEach(() => {
  document.body.innerHTML = '';
  document.documentElement.removeAttribute(THEME_ATTRIBUTE);
  try {
    window.localStorage.clear();
  } catch {
    // см. beforeEach
  }
});

describe('normalizeTheme / toggleTheme', () => {
  it('тёмной считается только явная строка dark', () => {
    expect(normalizeTheme('dark')).toBe('dark');
    expect(normalizeTheme('light')).toBe('light');
    expect(normalizeTheme(null)).toBe('light');
    expect(normalizeTheme(undefined)).toBe('light');
    expect(normalizeTheme('')).toBe('light');
    expect(normalizeTheme('auto')).toBe('light');
    expect(normalizeTheme('DARK')).toBe('light');
  });

  it('переключает тему в обе стороны', () => {
    expect(toggleTheme('light')).toBe('dark');
    expect(toggleTheme('dark')).toBe('light');
  });
});

describe('readStoredTheme / saveTheme', () => {
  it('без сохранённого выбора включает светлую тему', () => {
    expect(readStoredTheme(fakeStorage())).toBe('light');
    expect(readStoredTheme(null)).toBe('light');
  });

  it('читает сохранённую тёмную тему', () => {
    expect(readStoredTheme(fakeStorage({ [THEME_STORAGE_KEY]: 'dark' }))).toBe('dark');
  });

  it('битое значение не включает тёмную тему', () => {
    expect(readStoredTheme(fakeStorage({ [THEME_STORAGE_KEY]: 'ночной собор' }))).toBe('light');
  });

  it('недоступное хранилище при чтении не роняет приложение', () => {
    expect(readStoredTheme(fakeStorage({}, { throwOnRead: true }))).toBe('light');
  });

  it('сохраняет выбор и сообщает об отказе хранилища', () => {
    const storage = fakeStorage();
    expect(saveTheme('dark', storage)).toBe(true);
    expect(storage.data[THEME_STORAGE_KEY]).toBe('dark');

    expect(saveTheme('dark', null)).toBe(false);
    expect(saveTheme('dark', fakeStorage({}, { throwOnWrite: true }))).toBe(false);
  });

  it('испорченный localStorage в браузере не мешает сохранить выбор', () => {
    expect(saveTheme('dark', window.localStorage)).toBe(true);
    expect(readStoredTheme(window.localStorage)).toBe('dark');
  });
});

describe('атрибут темы на <html>', () => {
  it('тёмная ставит data-theme, светлая снимает атрибут', () => {
    const root = html();
    applyTheme('dark', root);
    expect(root.getAttribute(THEME_ATTRIBUTE)).toBe('dark');
    applyTheme('light', root);
    expect(root.hasAttribute(THEME_ATTRIBUTE)).toBe(false);
  });

  it('чужое значение атрибута не считается темой', () => {
    const root = html();
    root.setAttribute(THEME_ATTRIBUTE, 'sepia');
    expect(readThemeAttribute(root)).toBeNull();
    root.setAttribute(THEME_ATTRIBUTE, 'light');
    expect(readThemeAttribute(root)).toBe('light');
  });

  it('null вместо корня не роняет функции', () => {
    expect(readThemeAttribute(null)).toBeNull();
    expect(() => applyTheme('dark', null)).not.toThrow();
  });
});

describe('initialTheme', () => {
  it('по умолчанию — светлая', () => {
    expect(initialTheme(html(), fakeStorage())).toBe('light');
  });

  it('берёт сохранённый выбор, если атрибута ещё нет', () => {
    expect(initialTheme(html(), fakeStorage({ [THEME_STORAGE_KEY]: 'dark' }))).toBe('dark');
  });

  it('атрибут из inline-скрипта важнее хранилища (иначе вспышка светлой)', () => {
    const root = html();
    root.setAttribute(THEME_ATTRIBUTE, 'dark');
    expect(initialTheme(root, fakeStorage({ [THEME_STORAGE_KEY]: 'light' }))).toBe('dark');
  });
});
