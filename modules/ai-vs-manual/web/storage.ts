import type { MeasureSession, MeasureSummary } from './format';
import { MAX_SESSIONS, parseSessions } from './format';

/**
 * Сессии замера К4 живут в браузере: серверной таблицы модуля пока нет (❓).
 * Любая ошибка localStorage (приватный режим, выключенное хранилище) не ломает экран.
 */

export const STORAGE_KEY = 'ugra.ai-vs-manual.sessions.v1';

/** Определение ручного действия — одно и то же на экране, в экспорте и в отчёте. */
export const MANUAL_ACTION_DEFINITION =
  'Ручное действие — клик, ввод символа в поле, выбор из списка, переход по полю и поиск в справочнике или CMDB. Считает счётчик интерфейса, а не человек.';

function safeStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Сохранённые замеры; битые или чужие данные дают пустой список. */
export function loadSessions(storage: Storage | null = safeStorage()): MeasureSession[] {
  if (!storage) return [];
  try {
    return parseSessions(storage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

/** Записать замеры. Возвращает `false`, если браузер не дал сохранить. */
export function saveSessions(
  sessions: readonly MeasureSession[],
  storage: Storage | null = safeStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(sessions.slice(0, MAX_SESSIONS)));
    return true;
  } catch {
    return false;
  }
}

export function clearSessions(storage: Storage | null = safeStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // Хранилище недоступно — чистить нечего.
  }
}

/** JSON для слайда: итог, сессии и определение действия; демо-замеры помечены. */
export function exportPayload(sessions: readonly MeasureSession[], summary: MeasureSummary): string {
  return JSON.stringify(
    {
      app: 'ai-vs-manual',
      criterion: 'К4',
      generatedAt: new Date().toISOString(),
      note: 'demo=true — предзаполненные данные для показа, не настоящий замер.',
      definition: MANUAL_ACTION_DEFINITION,
      summary,
      sessions,
    },
    null,
    2,
  );
}

export function exportFileName(now: Date = new Date()): string {
  const date = Number.isNaN(now.getTime()) ? new Date() : now;
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `ai-vs-manual-${date.getFullYear()}-${month}-${day}.json`;
}

/** Скачать файл в браузере; вне браузера — `false`, без исключений. */
export function downloadJson(text: string, fileName: string): boolean {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return false;
  try {
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.rel = 'noopener';
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    return true;
  } catch {
    return false;
  }
}
