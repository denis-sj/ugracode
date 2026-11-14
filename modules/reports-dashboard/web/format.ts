/** Форматирование дашборда: чистые функции, без DOM и React. */

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

export function formatMinutes(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes)) return '—';
  if (minutes < 60) return `${Math.round(minutes)} мин`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return rest === 0 ? `${hours} ч` : `${hours} ч ${rest} мин`;
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

/** Короткий диапазон дат: «1–14 нояб.» или «28 окт. — 14 нояб.». */
export function formatDateRange(from: string, to: string): string {
  const start = new Date(from);
  const end = new Date(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '—';
  const startMonth = MONTHS[start.getMonth()] ?? '';
  const endMonth = MONTHS[end.getMonth()] ?? '';
  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
    return `${start.getDate()}–${end.getDate()} ${endMonth}`;
  }
  return `${start.getDate()} ${startMonth} — ${end.getDate()} ${endMonth}`;
}

/** Насыщенность клетки тепловой карты: 0…1 от максимума. */
export function heatLevel(count: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(1, Math.max(0, count / max));
}
