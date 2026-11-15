import { describe, expect, it } from 'vitest';
import { hotspotsView, splitHotspotLabel } from '../web/format';

const payload = {
  report: {
    period: { from: '2026-10-15', to: '2026-11-14', days: 30 },
    total: 100,
    previousTotal: 80,
    trendPercent: 25,
    repeatedTickets: 40,
    rows: [
      { key: 'cab:a:201', kind: 'cabinet', label: 'Корпус А · каб. 201', count: 4, sharePercent: 4, avgResolutionMinutes: 45, previousCount: 4, trendPercent: 0 },
      { key: 'eq:p', kind: 'equipment', label: 'HP LaserJet Pro M404dn · Корпус Б · каб. 312', count: 9, sharePercent: 9, avgResolutionMinutes: 766, previousCount: 2, trendPercent: 350 },
      { key: 'eq:x', kind: 'equipment', label: 'Dell OptiPlex · Корпус Б · каб. 311', count: 2, sharePercent: 2, avgResolutionMinutes: null, previousCount: 0, trendPercent: null },
      { key: 'one', kind: 'cabinet', label: 'Корпус В · каб. 105', count: 1, sharePercent: 1, avgResolutionMinutes: 10, previousCount: 0, trendPercent: null },
    ],
  },
  facts: [],
  insight: { meaning: '', actions: [], source: 'template', model: null },
};

describe('наглядный вид «Горячих точек»', () => {
  it('лидер первым, одиночные обращения отброшены, цвет по доле от лидера', () => {
    const view = hotspotsView(payload);
    expect(view?.rows.map((row) => row.key)).toEqual(['eq:p', 'cab:a:201', 'eq:x']);
    expect(view?.rows[0]).toMatchObject({ rank: 1, title: 'HP LaserJet Pro M404dn', place: 'Корпус Б · каб. 312', width: 100, tone: 'hot', trend: '+350%', avg: '12 ч 46 мин' });
    expect(view?.rows[1]).toMatchObject({ title: 'Кабинет 201', tone: 'warm', trend: 'без изменений' });
    expect(view?.rows[2]).toMatchObject({ tone: 'calm', trend: 'новая', avg: '—' });
  });

  it('плитки: всего, тренд, доля повторов', () => {
    const view = hotspotsView(payload);
    expect(view).toMatchObject({ days: 30, total: 100, trend: '+25%', trendUp: true, repeated: 40, repeatedShare: 40 });
  });

  it('пустой или чужой ответ — null или пустой рейтинг', () => {
    expect(hotspotsView(null)).toBeNull();
    expect(hotspotsView({ report: { total: 0, rows: [] } })?.rows).toEqual([]);
  });

  it('делит подпись на «что» и «где»', () => {
    expect(splitHotspotLabel('Корпус Б · каб. 115', 'cabinet')).toEqual({ title: 'Кабинет 115', place: 'Корпус Б · каб. 115' });
    expect(splitHotspotLabel('Сервер', 'equipment')).toEqual({ title: 'Сервер', place: 'Сервер' });
  });
});
