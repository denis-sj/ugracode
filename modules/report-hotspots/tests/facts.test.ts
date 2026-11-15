import { describe, expect, it } from 'vitest';
import type { HotspotsResult } from '../contracts';
import { durationText, factsOf } from '../server/index';

const period = { from: '2026-10-15', to: '2026-11-14', days: 30 };

const result: HotspotsResult = {
  period,
  previousPeriod: period,
  filters: {},
  total: 40,
  previousTotal: 30,
  trendPercent: 33.3,
  repeatedTickets: 12,
  rows: [
    {
      key: 'eq:eq-printer-b312',
      kind: 'equipment',
      equipmentId: 'eq-printer-b312',
      label: 'HP LaserJet Pro M404dn · Корпус Б · каб. 312',
      building: 'Б',
      cabinet: '312',
      category: 'printer',
      count: 9,
      sharePercent: 22.5,
      avgResolutionMinutes: 766,
      previousCount: 2,
      trendPercent: 350,
    },
  ],
};

describe('факты горячих точек для вывода модели', () => {
  it('подписывает точку её местом, а время — часами и минутами', () => {
    const facts = factsOf(result);
    const labels = facts.map((fact) => fact.label);
    expect(labels.some((label) => label.startsWith('Точка'))).toBe(false);
    expect(facts).toContainEqual({ label: 'HP LaserJet Pro M404dn · Корпус Б · каб. 312: заявок', value: 9 });
    expect(facts).toContainEqual({
      label: 'HP LaserJet Pro M404dn · Корпус Б · каб. 312: среднее решение',
      value: '12 ч 46 мин',
    });
  });

  it('без среднего времени — «нет данных»', () => {
    const facts = factsOf({ ...result, rows: [{ ...result.rows[0]!, avgResolutionMinutes: null }] });
    expect(facts.find((fact) => fact.label.endsWith('среднее решение'))?.value).toBe('нет данных');
  });

  it('длительность по-человечески', () => {
    expect(durationText(45)).toBe('45 мин');
    expect(durationText(120)).toBe('2 ч');
    expect(durationText(766)).toBe('12 ч 46 мин');
    expect(durationText(2171)).toBe('1 дн 12 ч');
    expect(durationText(1440)).toBe('1 дн');
    expect(durationText(-5)).toBe('0 мин');
  });
});
