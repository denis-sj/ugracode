import { describe, expect, it } from 'vitest';
import type { Heatmap } from '../contracts';
import {
  barPercent,
  countDelta,
  formatCount,
  formatDateRange,
  formatMinutes,
  formatPercent,
  heatLevel,
  heatTotal,
  heatmapIsEmpty,
  isValidRange,
  minutesDelta,
  percentDelta,
  periodName,
  periodTitle,
  pointsDelta,
  rangeEnd,
  rangeStart,
} from '../web/format';

const heatmap = (days: Heatmap['days'], max: number): Heatmap => ({
  days,
  hours: [8],
  max,
});

describe('format дашборда', () => {
  it('форматирует время решения и проценты', () => {
    expect(formatMinutes(45)).toBe('45 мин');
    expect(formatMinutes(160)).toBe('2 ч 40 мин');
    expect(formatMinutes(120)).toBe('2 ч');
    expect(formatMinutes(null)).toBe('—');
    expect(formatPercent(93.4)).toBe('93.4%');
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(null)).toBe('—');
  });

  it('группирует разряды целых чисел', () => {
    expect(formatCount(1284)).toBe('1\u00A0284');
    expect(formatCount(0)).toBe('0');
    expect(formatCount(-600)).toBe('−600');
    expect(formatCount(null)).toBe('—');
  });

  it('показывает ▲/▼ и тон сравнения', () => {
    expect(percentDelta(9)).toEqual({ text: '▲ 9%', tone: 'warn' });
    expect(percentDelta(-4)).toEqual({ text: '▼ 4%', tone: 'ok' });
    expect(percentDelta(0)).toMatchObject({ tone: 'muted' });
    expect(percentDelta(null)).toMatchObject({ tone: 'muted', text: 'нет сравнения' });
    expect(percentDelta(null)).toMatchObject({ tone: 'muted' });
    expect(countDelta(2)).toMatchObject({ text: '▲ 2', tone: 'warn' });
    expect(countDelta(-2)).toMatchObject({ text: '▼ 2', tone: 'ok' });
    expect(countDelta(2, false)).toMatchObject({ text: '▲ 2', tone: 'ok' });
    expect(countDelta(0)).toMatchObject({ tone: 'muted' });
    expect(countDelta(null)).toMatchObject({ tone: 'muted' });
    expect(pointsDelta(-1)).toMatchObject({ text: '▼ 1 п.', tone: 'warn' });
    expect(pointsDelta(3)).toMatchObject({ text: '▲ 3 п.', tone: 'ok' });
    expect(pointsDelta(0)).toMatchObject({ tone: 'muted' });
    expect(minutesDelta(-20)).toMatchObject({ text: '▼ 20 мин', tone: 'ok' });
    expect(minutesDelta(15)).toMatchObject({ text: '▲ 15 мин', tone: 'warn' });
    expect(minutesDelta(0)).toMatchObject({ tone: 'muted' });
  });

  it('считает диапазон дат и уровень тепловой карты', () => {
    expect(formatDateRange('2026-11-01T12:00:00', '2026-11-14T12:00:00')).toBe('1–14 ноя');
    expect(formatDateRange('2026-10-28T12:00:00', '2026-11-14T12:00:00')).toBe('28 окт — 14 ноя');
    expect(heatLevel(5, 10)).toBe(0.5);
    expect(heatLevel(20, 10)).toBe(1);
    expect(heatLevel(-3, 10)).toBe(0);
    expect(heatLevel(0, 0)).toBe(0);
  });

  it('называет период и проверяет выбранные даты', () => {
    expect(periodName(1)).toBe('смену');
    expect(periodName(7)).toBe('7 дней');
    expect(periodName(30)).toBe('30 дней');
    expect(periodName(90)).toBe('квартал');
    expect(periodTitle(7)).toBe('7 дней');
    expect(periodTitle(30, '2026-11-01', '2026-11-14')).toBe('1–14 ноя');
    expect(isValidRange('2026-11-01', '2026-11-14')).toBe(true);
    expect(isValidRange('2026-11-14', '2026-11-01')).toBe(false);
    expect(isValidRange('', '2026-11-01')).toBe(false);
    expect(isValidRange('не дата', '2026-11-01')).toBe(false);
    expect(rangeStart('2026-11-01')).toBe('2026-11-01T00:00:00');
    expect(rangeEnd('2026-11-14')).toBe('2026-11-14T23:59:59');
  });

  it('считает высоту столбиков графика', () => {
    expect(barPercent(0, 10)).toBe(0);
    expect(barPercent(5, 10)).toBe(50);
    expect(barPercent(10, 10)).toBe(100);
    expect(barPercent(1, 1000)).toBe(2);
    expect(barPercent(5, 0)).toBe(0);
  });

  it('узнаёт пустую и непустую тепловую карту', () => {
    const empty = heatmap([{ day: 'Пн', cells: [{ hour: 8, count: 0 }] }], 0);
    expect(heatTotal(empty)).toBe(0);
    expect(heatmapIsEmpty(empty)).toBe(true);
    expect(heatmapIsEmpty(heatmap([], 0))).toBe(true);

    const onePoint = heatmap([{ day: 'Пн', cells: [{ hour: 9, count: 4 }] }], 4);
    expect(heatTotal(onePoint)).toBe(4);
    expect(heatmapIsEmpty(onePoint)).toBe(false);
  });
});
