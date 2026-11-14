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

/** Дата и время в локальном поясе: «14.11, 10:42». */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (part: number): string => String(part).padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
