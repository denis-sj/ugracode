import { describe, expect, it } from 'vitest';
import type { HotspotsResult } from '../contracts';
import { drilldownOf } from '../server';

const result: HotspotsResult = {
  period: { from: '2026-10-15T00:00:00.000Z', to: '2026-11-14T00:00:00.000Z', days: 30 },
  previousPeriod: { from: '2026-09-15T00:00:00.000Z', to: '2026-10-14T00:00:00.000Z', days: 30 },
  filters: {},
  total: 5,
  previousTotal: 4,
  trendPercent: 25,
  repeatedTickets: 3,
  rows: [
    {
      key: 'eq:b312',
      kind: 'equipment',
      equipmentId: 'eq-b312',
      label: 'HP LaserJet · Корпус Б · каб. 312',
      building: 'Б',
      cabinet: '312',
      category: 'printer',
      count: 3,
      sharePercent: 60,
      avgResolutionMinutes: 90,
      previousCount: 2,
      trendPercent: 50,
    },
    {
      key: 'cab:b:201',
      kind: 'cabinet',
      equipmentId: null,
      label: 'Корпус Б · каб. 201',
      building: 'Б',
      cabinet: '201',
      category: null,
      count: 2,
      sharePercent: 40,
      avgResolutionMinutes: null,
      previousCount: 0,
      trendPercent: null,
    },
  ],
};

describe('клик по цифре О2', () => {
  it('превращает точку в фильтр заявок', () => {
    expect(drilldownOf(result, 'eq:b312')).toEqual({
      days: 30,
      building: 'Б',
      cabinet: '312',
      category: 'printer',
      equipmentId: 'eq-b312',
    });
    expect(drilldownOf(result, 'cab:b:201')).toEqual({
      days: 30,
      building: 'Б',
      cabinet: '201',
    });
  });

  it('на общий итог и неизвестный ключ отдаёт только период', () => {
    expect(drilldownOf(result, 'total')).toEqual({ days: 30 });
    expect(drilldownOf(result, 'nope')).toEqual({ days: 30 });
  });
});
