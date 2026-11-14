import { describe, expect, it } from 'vitest';
import {
  clamp01,
  confidenceTone,
  elapsedMs,
  formatActions,
  formatConfidence,
  formatElapsed,
} from '../src/format';

describe('formatConfidence', () => {
  it('округляет и ограничивает значение', () => {
    expect(formatConfidence(0.876)).toBe('88\u00a0%');
    expect(formatConfidence(-1)).toBe('0\u00a0%');
    expect(formatConfidence(2)).toBe('100\u00a0%');
    expect(formatConfidence(Number.NaN)).toBe('0\u00a0%');
  });
});

describe('confidenceTone', () => {
  it('делит уверенность на зелёную, жёлтую и красную зоны', () => {
    expect(confidenceTone(0.9)).toBe('ok');
    expect(confidenceTone(0.75)).toBe('ok');
    expect(confidenceTone(0.5)).toBe('warn');
    expect(confidenceTone(0.2)).toBe('danger');
  });

  it('учитывает свой порог', () => {
    expect(confidenceTone(0.6, 0.5)).toBe('ok');
    expect(confidenceTone(0.2, 0.5)).toBe('danger');
  });
});

describe('clamp01', () => {
  it('не пропускает значения вне диапазона', () => {
    expect(clamp01(0.42)).toBe(0.42);
    expect(clamp01(7)).toBe(1);
    expect(clamp01(-7)).toBe(0);
  });
});

describe('formatActions', () => {
  it('подписывает счётчик действий', () => {
    expect(formatActions(12)).toBe('Действий: 12');
    expect(formatActions(-5)).toBe('Действий: 0');
  });
});

describe('elapsedMs', () => {
  it('считает разницу по ISO, Date и числу', () => {
    const now = Date.parse('2026-11-14T12:00:00.000Z');
    expect(elapsedMs('2026-11-14T11:59:00.000Z', now)).toBe(60_000);
    expect(elapsedMs(new Date(now - 5_000), now)).toBe(5_000);
    expect(elapsedMs(now - 1_500, now)).toBe(1_500);
  });

  it('будущее, пустое и битое значение дают ноль', () => {
    const now = Date.parse('2026-11-14T12:00:00.000Z');
    expect(elapsedMs('2026-11-14T12:01:00.000Z', now)).toBe(0);
    expect(elapsedMs(null, now)).toBe(0);
    expect(elapsedMs(undefined, now)).toBe(0);
    expect(elapsedMs('', now)).toBe(0);
    expect(elapsedMs('не дата', now)).toBe(0);
    expect(elapsedMs(now, Number.NaN)).toBe(0);
  });
});

describe('formatElapsed', () => {
  it('формат таймера: минуты и секунды, часы при переходе', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(7_000)).toBe('0:07');
    expect(formatElapsed(65_000)).toBe('1:05');
    expect(formatElapsed(3_600_000)).toBe('1:00:00');
    expect(formatElapsed(3_726_000)).toBe('1:02:06');
  });

  it('короткий формат для SLA: минуты и часы', () => {
    expect(formatElapsed(30_000, 'short')).toBe('меньше минуты');
    expect(formatElapsed(60_000, 'short')).toBe('1 мин');
    expect(formatElapsed(12 * 60_000, 'short')).toBe('12 мин');
    expect(formatElapsed(3_600_000, 'short')).toBe('1 ч');
    expect(formatElapsed(3 * 3_600_000 + 26 * 60_000, 'short')).toBe('3 ч 26 мин');
  });

  it('отрицательное и битое значение — ноль, а не отрицательный таймер', () => {
    expect(formatElapsed(-5_000)).toBe('0:00');
    expect(formatElapsed(Number.NaN)).toBe('0:00');
    expect(formatElapsed(-5_000, 'short')).toBe('меньше минуты');
  });
});
