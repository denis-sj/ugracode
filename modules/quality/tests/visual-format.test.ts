import { describe, expect, it } from 'vitest';
import { metricViews, percentOf, qualityScore, thresholdPercent } from '../web/format';
import type { MetricRow } from '../web/format';

const row = (key: string, display: string, threshold: string, state: MetricRow['state']): MetricRow => ({
  key,
  title: key,
  display,
  threshold,
  state,
});

describe('наглядный вид «Качества ИИ»', () => {
  it('проценты и порог для полосы', () => {
    expect(percentOf('84 %')).toBe(84);
    expect(percentOf('100%')).toBe(100);
    expect(percentOf('14,8 с')).toBeNull();
    expect(percentOf('—')).toBeNull();
    expect(thresholdPercent('≥ 90 %')).toBe(90);
    expect(thresholdPercent('≤ 8 с')).toBeNull();
  });

  it('пояснение метрики человеческим языком', () => {
    const [view] = metricViews([row('fields', '84 %', '≥ 90 %', 'unmet')]);
    expect(view).toMatchObject({ explain: 'Поля заявки совпали с эталоном', percent: 84, thresholdAt: 90 });
    expect(metricViews([row('unknown', '1', '0', 'met')])[0]?.explain).toBe('unknown');
  });

  it('балл: пройдено из проверяемых, «не проверяли» не считаются', () => {
    const metrics = [
      row('fields', '84 %', '≥ 90 %', 'unmet'),
      row('emergency', '0', '0', 'met'),
      row('article', '100 %', '≥ 80 %', 'met'),
      row('question', '—', '≥ 80 %', 'none'),
    ];
    const score = qualityScore(null, metrics);
    expect(score).toMatchObject({ met: 2, total: 3, percent: 67, verdict: 'ИИ требует настройки' });
    expect(score.gaps).toEqual(['fields 84 % (нужно ≥ 90 %)']);
    expect(score.unchecked).toEqual(['question']);
  });

  it('всё пройдено и пустой набор', () => {
    expect(qualityScore(null, [row('a', '1', '0', 'met')]).verdict).toBe('ИИ проходит все проверки качества');
    expect(qualityScore(null, [row('a', '1', '0', 'met'), row('b', '1', '0', 'met'), row('c', '1', '0', 'met'), row('d', '1', '0', 'unmet')]).verdict).toBe(
      'ИИ проходит большую часть проверок',
    );
    expect(qualityScore(null, []).verdict).toBe('Проверок с эталоном пока нет');
  });
});
