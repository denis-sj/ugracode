/** Форматирование дашборда: чистые функции, без DOM и React. */

import type { Heatmap } from '../contracts';

export type DeltaTone = 'ok' | 'warn' | 'danger' | 'muted';

export interface DeltaView {
  text: string;
  tone: DeltaTone;
}

const MONTHS = [
  'янв',
  'фев',
  'мар',
  'апр',
  'мая',
  'июн',
  'июл',
  'авг',
  'сен',
  'окт',
  'ноя',
  'дек',
];

/** Пробел-разделитель разрядов: неразрывный, чтобы «1 284» не рвалось на две строки. */
const THIN_SPACE = '\u00A0';

export function formatMinutes(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes)) return '—';
  if (minutes < 60) return `${Math.round(minutes)} мин`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return rest === 0 ? `${hours} ч` : `${hours} ч ${rest} мин`;
}

/** Целое число с разрядами: 1284 → «1 284». */
export function formatCount(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const rounded = Math.round(value);
  const sign = rounded < 0 ? '−' : '';
  return sign + String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, THIN_SPACE);
}

export function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value}%`;
}

function arrow(value: number): string {
  if (value > 0) return '▲';
  if (value < 0) return '▼';
  return '=';
}

/** Изменение числа обращений: рост — внимание, падение — хорошо. */
export function percentDelta(value: number | null): DeltaView {
  if (value === null || !Number.isFinite(value)) return { text: 'нет сравнения', tone: 'muted' };
  if (value === 0) return { text: 'как в прошлом периоде', tone: 'muted' };
  return {
    text: `${arrow(value)} ${Math.abs(value)}%`,
    tone: value > 0 ? 'warn' : 'ok',
  };
}

export function countDelta(value: number | null, positiveIsBad = true): DeltaView {
  if (value === null || !Number.isFinite(value)) return { text: 'нет сравнения', tone: 'muted' };
  if (value === 0) return { text: 'как в прошлом периоде', tone: 'muted' };
  const tone: DeltaTone = value > 0 ? (positiveIsBad ? 'warn' : 'ok') : positiveIsBad ? 'ok' : 'warn';
  return { text: `${arrow(value)} ${Math.abs(value)}`, tone };
}

/** Изменение доли «в срок» в процентных пунктах: рост — хорошо. */
export function pointsDelta(value: number | null): DeltaView {
  if (value === null || !Number.isFinite(value)) return { text: 'нет сравнения', tone: 'muted' };
  if (value === 0) return { text: 'без изменений', tone: 'muted' };
  return {
    text: `${arrow(value)} ${Math.abs(value)} п.`,
    tone: value > 0 ? 'ok' : 'warn',
  };
}

/** Изменение среднего времени решения: быстрее (минус) — хорошо. */
export function minutesDelta(value: number | null): DeltaView {
  if (value === null || !Number.isFinite(value)) return { text: 'нет сравнения', tone: 'muted' };
  if (value === 0) return { text: 'без изменений', tone: 'muted' };
  return {
    text: `${arrow(value)} ${formatMinutes(Math.abs(value))}`,
    tone: value < 0 ? 'ok' : 'warn',
  };
}

/** `YYYY-MM-DD` из поля даты — это календарный день, а не UTC-полночь. */
function parseDay(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return new Date(value);
  const [, year = '', month = '', day = ''] = match;
  return new Date(Number(year), Number(month) - 1, Number(day));
}

/** Короткий диапазон дат: «1–14 ноя» или «28 окт — 14 ноя». */
export function formatDateRange(from: string, to: string): string {
  const start = parseDay(from);
  const end = parseDay(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '—';
  const startMonth = MONTHS[start.getMonth()] ?? '';
  const endMonth = MONTHS[end.getMonth()] ?? '';
  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
    return `${start.getDate()}–${end.getDate()} ${endMonth}`;
  }
  return `${start.getDate()} ${startMonth} — ${end.getDate()} ${endMonth}`;
}

/** Название периода для заголовка: «смену», «7 дней», «квартал». */
export function periodName(days: number): string {
  if (days === 1) return 'смену';
  if (days === 90) return 'квартал';
  return `${days} дней`;
}

/** Заголовок страницы: выбранный диапазон важнее пресета. */
export function periodTitle(days: number, from = '', to = ''): string {
  return isValidRange(from, to) ? formatDateRange(from, to) : periodName(days);
}

/** Оба конца диапазона заполнены и конец не раньше начала. */
export function isValidRange(from: string, to: string): boolean {
  if (from === '' || to === '') return false;
  const start = Date.parse(from);
  const end = Date.parse(to);
  return Number.isFinite(start) && Number.isFinite(end) && start <= end;
}

/** Календарный день начала — как есть, конец — до последней секунды дня. */
export function rangeStart(from: string): string {
  return `${from}T00:00:00`;
}

export function rangeEnd(to: string): string {
  return `${to}T23:59:59`;
}

/** Насыщенность клетки тепловой карты: 0…1 от максимума. */
export function heatLevel(count: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(1, Math.max(0, count / max));
}

/** Сумма обращений во всех клетках карты. */
export function heatTotal(heatmap: Heatmap): number {
  return heatmap.days.reduce(
    (sum, row) => sum + row.cells.reduce((rowSum, cell) => rowSum + cell.count, 0),
    0,
  );
}

/** Пустая карта: нет ни одной заявки в рабочих часах (или нет строк). */
export function heatmapIsEmpty(heatmap: Heatmap): boolean {
  return heatmap.days.length === 0 || heatTotal(heatmap) === 0;
}

/** Высота столбика в процентах: нулевое значение не рисуем, ненулевое — не меньше 4 px. */
export function barPercent(count: number, max: number): number {
  if (max <= 0 || count <= 0) return 0;
  return Math.max(2, Math.round((count / max) * 100));
}
