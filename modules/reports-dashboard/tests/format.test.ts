import { describe, expect, it } from 'vitest';
import {
  countDelta,
  formatDateRange,
  formatMinutes,
  formatPercent,
  heatLevel,
  minutesDelta,
  percentDelta,
  pointsDelta,
} from '../web/format';

describe('format дашборда', () => {
  it('форматирует время решения и проценты', () => {
    expect(formatMinutes(45)).toBe('45 мин');
    expect(formatMinutes(160)).toBe('2 ч 40 мин');
    expect(formatMinutes(120)).toBe('2 ч');
    expect(formatMinutes(null)).toBe('—');
    expect(formatPercent(93.4)).toBe('93.4%');
    expect(formatPercent(null)).toBe('—');
  });

  it('показывает ▲/▼ и тон сравнения', () => {
    expect(percentDelta(9)).toEqual({ text: '▲ 9%', tone: 'warn' });
    expect(percentDelta(-4)).toEqual({ text: '▼ 4%', tone: 'ok' });
    expect(percentDelta(0)).toMatchObject({ tone: 'muted' });
    expect(percentDelta(null)).toMatchObject({ tone: 'muted' });
    expect(countDelta(2)).toMatchObject({ text: '▲ 2', tone: 'warn' });
    expect(pointsDelta(-1)).toMatchObject({ text: '▼ 1 п.', tone: 'warn' });
    expect(minutesDelta(-20)).toMatchObject({ text: '▼ 20 мин', tone: 'ok' });
  });

  it('считает диапазон дат и уровень тепловой карты', () => {
    expect(formatDateRange('2026-11-01T12:00:00', '2026-11-14T12:00:00')).toBe('1–14 ноя');
    expect(formatDateRange('2026-10-28T12:00:00', '2026-11-14T12:00:00')).toBe('28 окт — 14 ноя');
    expect(heatLevel(5, 10)).toBe(0.5);
    expect(heatLevel(20, 10)).toBe(1);
    expect(heatLevel(0, 0)).toBe(0);
  });
});
