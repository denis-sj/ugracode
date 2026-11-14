import { describe, expect, it } from 'vitest';
import { clamp01, confidenceTone, formatActions, formatConfidence } from '../src/format';

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
