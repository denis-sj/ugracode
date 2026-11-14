/** Чистые функции форматирования: тестируются без DOM. */

export type ConfidenceTone = 'ok' | 'warn' | 'danger';

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** «87 %» — с неразрывным пробелом перед знаком процента. */
export function formatConfidence(value: number): string {
  return `${Math.round(clamp01(value) * 100)}\u00a0%`;
}

/**
 * Цвет шкалы уверенности. Порог по умолчанию — как в настройках (`confidenceThreshold`).
 * Ниже 60 % от порога — «опасно», между — «на проверку».
 */
export function confidenceTone(value: number, threshold = 0.75): ConfidenceTone {
  const safeThreshold = clamp01(threshold);
  const normalized = clamp01(value);
  if (normalized >= safeThreshold) return 'ok';
  if (normalized >= safeThreshold * 0.6) return 'warn';
  return 'danger';
}

/** «Действий: 12» — подпись счётчика для К4. */
export function formatActions(count: number): string {
  const safe = Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0;
  return `Действий: ${safe}`;
}

export type ElapsedStyle = 'clock' | 'short';

/** Миллисекунды с момента `from`; будущее и мусор дают 0. */
export function elapsedMs(
  from: string | number | Date | null | undefined,
  now: number = Date.now(),
): number {
  if (from === null || from === undefined || from === '') return 0;
  const startedAt = from instanceof Date ? from.getTime() : typeof from === 'number' ? from : Date.parse(from);
  if (!Number.isFinite(startedAt) || !Number.isFinite(now)) return 0;
  return Math.max(0, now - startedAt);
}

/**
 * Прошедшее время для таймера аварии и SLA.
 * `clock` — «0:07», «12:40», «1:03:09»; `short` — «меньше минуты», «12 мин», «3 ч 26 мин».
 * Отрицательные и нечисловые значения дают ноль, а не «-1:05».
 */
export function formatElapsed(ms: number, style: ElapsedStyle = 'clock'): string {
  const safeMs = Number.isFinite(ms) ? Math.max(0, Math.round(ms)) : 0;
  const totalSeconds = Math.floor(safeMs / 1000);
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);

  if (style === 'short') {
    if (totalSeconds < 60) return 'меньше минуты';
    if (hours === 0) return `${Math.max(1, minutes)} мин`;
    return minutes === 0 ? `${hours} ч` : `${hours} ч ${minutes} мин`;
  }

  const seconds = totalSeconds % 60;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** Дата и время в локальном поясе: «14.11, 10:42». */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (part: number): string => String(part).padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
