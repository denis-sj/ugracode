import { describe, expect, it } from 'vitest';
import type { EmergencyVerdict, Ticket, TicketField } from '@ugra/contracts';
import {
  MASS_THRESHOLD,
  MASS_WINDOW_MINUTES,
  channelLabel,
  emergencyLevelLabel,
  emergencyReason,
  formatAge,
  formatTimer,
  incidentNumber,
  incidentTimer,
  massTimeline,
  placeFromFields,
  placeLabel,
  quoteSegments,
  readEmergencyVerdict,
  signLabel,
  similarTickets,
  sortByRecent,
  timelineItems,
  type Place,
} from '../web/format';

const NOW = Date.parse('2026-11-14T10:00:00.000Z');
const MINUTE = 60_000;

function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 't-1',
    number: 'З-0415',
    appealId: 'a-1',
    status: 'in_review',
    priority: 'emergency',
    category: 'printer',
    departmentId: 'dep-it',
    assigneeId: null,
    isEmergency: true,
    incidentId: null,
    reactDueAt: null,
    slaDueAt: null,
    equipmentId: null,
    locationId: null,
    confirmedBy: null,
    confirmedAt: null,
    createdAt: '2026-11-14T09:50:00.000Z',
    updatedAt: '2026-11-14T09:50:00.000Z',
    ...overrides,
  };
}

function field(fieldKey: string, value: string | number | null): TicketField {
  return {
    ticketId: 't-1',
    fieldKey,
    value,
    confidence: 0.9,
    quote: null,
    origin: 'text',
    needsReview: false,
    trace: [],
    aiValue: value,
  };
}

function place(building: string | null, cabinet: string | null = null): Place {
  return { building, cabinet, floor: null };
}

function verdict(patch: Partial<EmergencyVerdict> = {}): EmergencyVerdict {
  return {
    level: 'confirmed',
    signs: [{ sign: 'smoke', quote: 'идёт дым' }],
    confidence: 0.97,
    rulesMatched: ['emergency.fire'],
    checklist: ['Обесточьте оборудование.'],
    notifyUserIds: ['u-duty'],
    ...patch,
  };
}

describe('emergency UI: место заявки', () => {
  it('читает корпус, кабинет и этаж из полей', () => {
    const parsed = placeFromFields([
      field('building', 'А'),
      field('cabinet', '105'),
      field('floor', '1'),
      field('object', 'принтер'),
    ]);
    expect(parsed).toEqual({ building: 'А', cabinet: '105', floor: '1' });
    expect(placeLabel(parsed)).toBe('Корпус А · 1 этаж · каб. 105');
  });

  it('не выдумывает место при пустых данных', () => {
    expect(placeFromFields(null)).toEqual({ building: null, cabinet: null, floor: null });
    expect(placeFromFields([field('building', null)])).toEqual({
      building: null,
      cabinet: null,
      floor: null,
    });
    expect(placeLabel(null)).toBe('—');
    expect(placeLabel(place(null))).toBe('—');
  });

  it('не дублирует слово «корпус»', () => {
    expect(placeLabel(place('Корпус Б', '312'))).toBe('Корпус Б · каб. 312');
  });
});

describe('emergency UI: «почему авария» из разбора', () => {
  it('читает вердикт из analysis.emergency', () => {
    const parsed = readEmergencyVerdict({ emergency: verdict(), fields: {}, sources: [] });
    expect(parsed).toEqual(verdict());
  });

  it('терпит мусор и битые поля', () => {
    expect(readEmergencyVerdict(null)).toBeNull();
    expect(readEmergencyVerdict({})).toBeNull();
    expect(readEmergencyVerdict({ emergency: { level: 'maybe' } })).toBeNull();
    expect(readEmergencyVerdict({ emergency: 'нет' })).toBeNull();

    const parsed = readEmergencyVerdict({
      emergency: {
        level: 'suspected',
        signs: [{ sign: 'smoke', quote: 'дым' }, { quote: 'без кода' }, null],
        confidence: 4,
        rulesMatched: ['emergency.fire', 7],
      },
    });
    expect(parsed).toEqual({
      level: 'suspected',
      signs: [{ sign: 'smoke', quote: 'дым' }],
      confidence: 1,
      rulesMatched: ['emergency.fire'],
      checklist: [],
      notifyUserIds: [],
    });
  });

  it('собирает фразу из признаков и правил', () => {
    expect(emergencyReason(verdict())).toBe('Признаки: «дым» · правила: emergency.fire.');
    expect(
      emergencyReason(verdict({ level: 'suspected', signs: [{ sign: 'unknown_code', quote: '' }] })),
    ).toBe('Под вопросом — Признаки: «unknown_code» · правила: emergency.fire.');
  });

  it('объясняет аварию без признаков и отсутствие разбора', () => {
    expect(emergencyReason(verdict({ signs: [], rulesMatched: [] }))).toBe(
      'Авария подтверждена правилами регламента.',
    );
    expect(emergencyReason(verdict({ level: 'suspected', signs: [], rulesMatched: [] }))).toBe(
      'Заявка помечена аварией, но признаков в тексте разбор не нашёл — проверьте вручную.',
    );
    expect(emergencyReason(null)).toContain('Разбор не нашёл признаков аварии');
    expect(emergencyReason(verdict({ level: 'none' }))).toContain('Разбор не нашёл признаков аварии');
  });

  it('переводит коды признаков и уровни', () => {
    expect(signLabel('water_leak')).toBe('протечка');
    expect(signLabel('custom')).toBe('custom');
    expect(emergencyLevelLabel('confirmed')).toBe('Авария');
    expect(emergencyLevelLabel('suspected')).toBe('Под вопросом');
    expect(emergencyLevelLabel('none')).toBe('Аварии нет');
  });
});

describe('emergency UI: таймер', () => {
  it('форматирует часы, минуты и секунды', () => {
    expect(formatTimer(0)).toBe('0:00');
    expect(formatTimer(47_000)).toBe('0:47');
    expect(formatTimer(754_000)).toBe('12:34');
    expect(formatTimer(3_789_000)).toBe('1:03:09');
  });

  it('не показывает отрицательное время и мусор', () => {
    expect(formatTimer(-5_000)).toBe('0:00');
    expect(formatTimer(Number.NaN)).toBe('0:00');
    expect(formatTimer(Number.POSITIVE_INFINITY)).toBe('0:00');
  });

  it('считает возраст обращения словами', () => {
    expect(formatAge(0)).toBe('< 1 мин');
    expect(formatAge(59_000)).toBe('< 1 мин');
    expect(formatAge(MINUTE)).toBe('1 мин');
    expect(formatAge(7_260_000)).toBe('2 ч 1 мин');
  });

  it('считает таймер с момента обращения', () => {
    expect(incidentTimer('2026-11-14T09:47:00.000Z', NOW)).toEqual({
      ms: 13 * MINUTE,
      clock: '13:00',
      age: '13 мин',
    });
    expect(incidentTimer('2026-11-14T10:05:00.000Z', NOW)).toEqual({ ms: 0, clock: '0:00', age: '< 1 мин' });
    expect(incidentTimer('не дата', NOW)).toEqual({ ms: 0, clock: '0:00', age: '< 1 мин' });
    expect(incidentTimer(null, NOW).ms).toBe(0);
  });
});

describe('emergency UI: список аварий', () => {
  it('сортирует свежие сверху', () => {
    const older = ticket({ id: 't-old', createdAt: '2026-11-14T08:00:00.000Z' });
    const newer = ticket({ id: 't-new', createdAt: '2026-11-14T09:58:00.000Z' });
    expect(sortByRecent([older, newer]).map((item) => item.id)).toEqual(['t-new', 't-old']);
  });

  it('не меняет исходный массив', () => {
    const list = [ticket({ id: 'a' }), ticket({ id: 'b', createdAt: '2026-11-14T09:59:00.000Z' })];
    const sorted = sortByRecent(list);
    expect(sorted).not.toBe(list);
    expect(list[0]?.id).toBe('a');
  });
});

describe('emergency UI: похожие заявки', () => {
  const places: Record<string, Place> = {
    't-target': place('Корпус А', '105'),
    't-same': place('А', '107'),
    't-other-building': place('Б', '105'),
    't-other-category': place('А', '105'),
    't-old': place('А', '105'),
    't-closed': place('А', '105'),
  };
  const placeOf = (id: string): Place | null => places[id] ?? null;

  const target = ticket({ id: 't-target', category: 'printer' });
  const same = ticket({
    id: 't-same',
    category: 'printer',
    createdAt: '2026-11-14T09:55:00.000Z',
  });
  const otherBuilding = ticket({
    id: 't-other-building',
    category: 'printer',
    createdAt: '2026-11-14T09:56:00.000Z',
  });
  const otherCategory = ticket({
    id: 't-other-category',
    category: 'network',
    createdAt: '2026-11-14T09:57:00.000Z',
  });
  const old = ticket({ id: 't-old', category: 'printer', createdAt: '2026-11-14T09:30:00.000Z' });
  const closed = ticket({
    id: 't-closed',
    category: 'printer',
    status: 'closed',
    createdAt: '2026-11-14T09:58:00.000Z',
  });

  it('берёт ту же категорию и корпус за окно, включая саму заявку', () => {
    const result = similarTickets(
      [target, same, otherBuilding, otherCategory, old, closed],
      target,
      placeOf,
      { now: NOW, windowMinutes: MASS_WINDOW_MINUTES },
    );
    expect(result.map((item) => item.id)).toEqual(['t-target', 't-same']);
  });

  it('умеет не считать саму заявку и учитывать закрытые', () => {
    const withoutTarget = similarTickets([target, same], target, placeOf, {
      now: NOW,
      includeTarget: false,
    });
    expect(withoutTarget.map((item) => item.id)).toEqual(['t-same']);

    const withClosed = similarTickets([target, same, closed], target, placeOf, {
      now: NOW,
      activeOnly: false,
    });
    expect(withClosed.map((item) => item.id)).toEqual(['t-target', 't-same', 't-closed']);
  });

  it('без категории или корпуса похожих нет', () => {
    expect(similarTickets([target], { ...target, category: null }, placeOf, { now: NOW })).toEqual([]);
    expect(similarTickets([target], target, () => place(null), { now: NOW })).toEqual([]);
    expect(similarTickets([target], null, placeOf, { now: NOW })).toEqual([]);
  });

  it('не считает заявки с битой датой и из будущего', () => {
    const broken = ticket({ id: 'broken', category: 'printer', createdAt: 'не дата' });
    const future = ticket({ id: 'future', category: 'printer', createdAt: '2026-11-14T11:00:00.000Z' });
    places.broken = place('А', '105');
    places.future = place('А', '105');
    expect(
      similarTickets([target, broken, future], target, placeOf, { now: NOW }).map((item) => item.id),
    ).toEqual(['t-target']);
  });
});

describe('emergency UI: столбики по минутам и порог', () => {
  const at = (minutesAgo: number): string => new Date(NOW - minutesAgo * MINUTE).toISOString();

  it('считает накопительно по минутам и ловит порог', () => {
    const mass = massTimeline(
      [
        ticket({ id: 'a', createdAt: at(7) }),
        ticket({ id: 'b', createdAt: at(3) }),
        ticket({ id: 'c', createdAt: at(2) }),
      ],
      NOW,
    );

    expect(mass.points).toHaveLength(MASS_WINDOW_MINUTES);
    expect(mass.total).toBe(3);
    expect(mass.threshold).toBe(MASS_THRESHOLD);
    expect(mass.thresholdMet).toBe(true);
    expect(mass.max).toBe(3);
    expect(mass.points.at(-1)?.count).toBe(3);
    expect(mass.points.some((point) => point.count === 1)).toBe(true);
    for (const point of mass.points) expect(point.label).toMatch(/^\d{2}:\d{2}$/);
  });

  it('порог не достигнут — шкала всё равно не ниже порога', () => {
    const mass = massTimeline([ticket({ id: 'a', createdAt: at(2) })], NOW, {
      windowMinutes: 15,
      threshold: 3,
    });
    expect(mass.total).toBe(1);
    expect(mass.thresholdMet).toBe(false);
    expect(mass.max).toBe(3);
  });

  it('пустые данные дают ровные нули', () => {
    const mass = massTimeline([], NOW);
    expect(mass.total).toBe(0);
    expect(mass.thresholdMet).toBe(false);
    expect(mass.points.every((point) => point.count === 0)).toBe(true);
  });

  it('не учитывает то, что вне окна и в будущем', () => {
    const mass = massTimeline(
      [ticket({ id: 'old', createdAt: at(40) }), ticket({ id: 'future', createdAt: at(-5) })],
      NOW,
      { windowMinutes: 15 },
    );
    expect(mass.total).toBe(0);
  });
});

describe('emergency UI: цитата с признаками', () => {
  it('выделяет цитаты без учёта регистра', () => {
    expect(quoteSegments('Принтер не печатает: идёт дым, запах гари', ['ДЫМ', 'гари'])).toEqual([
      { text: 'Принтер не печатает: идёт ', strong: false },
      { text: 'дым', strong: true },
      { text: ', запах ', strong: false },
      { text: 'гари', strong: true },
    ]);
  });

  it('без цитат возвращает один обычный фрагмент и терпит пустое', () => {
    expect(quoteSegments('Просто текст', [])).toEqual([{ text: 'Просто текст', strong: false }]);
    expect(quoteSegments('', ['дым'])).toEqual([]);
    expect(quoteSegments('Текст', ['ok', null])).toEqual([{ text: 'Текст', strong: false }]);
  });
});

describe('emergency UI: хронология', () => {
  it('сортирует события по времени и красит аварию', () => {
    const items = timelineItems([
      {
        id: 'e-2',
        type: 'ticket.status.changed',
        at: '2026-11-14T10:05:00.000Z',
        payload: { to: 'in_progress' },
      },
      {
        id: 'e-1',
        type: 'emergency.detected',
        at: '2026-11-14T10:00:00.000Z',
        payload: { level: 'confirmed', signs: [{ sign: 'smoke', quote: 'дым' }], rules: ['emergency.fire'] },
      },
    ]);

    expect(items.map((item) => item.id)).toEqual(['e-1', 'e-2']);
    expect(items[0]).toMatchObject({
      title: 'Признана авария',
      tone: 'danger',
      description: 'подтверждена · признаки: дым · правила: emergency.fire',
    });
    expect(items[0]?.at).toMatch(/^\d{2}:\d{2}$/);
    expect(items[1]).toMatchObject({ title: 'Статус изменён', description: '→ в работе', tone: 'info' });
  });

  it('подставляет имя исполнителя и терпит неизвестные события', () => {
    const items = timelineItems(
      [
        { id: 'e-1', type: 'ticket.assigned', at: '2026-11-14T10:00:00.000Z', payload: { assigneeId: 'u-1' } },
        { id: 'e-2', type: 'custom.event', at: 'битая дата', payload: null },
        'мусор',
      ],
      { resolveUser: (id) => (id === 'u-1' ? 'Ковалёв Д.' : null) },
    );

    expect(items).toHaveLength(2);
    expect(items[0]?.description).toBe('Ковалёв Д.');
    expect(items[1]).toEqual({
      id: 'e-2',
      title: 'custom.event',
      description: undefined,
      at: undefined,
      tone: 'neutral',
    });
  });

  it('пустой журнал даёт пустой список', () => {
    expect(timelineItems([])).toEqual([]);
  });
});

describe('emergency UI: канал и номер инцидента', () => {
  it('переводит канал обращения', () => {
    expect(channelLabel('phone')).toBe('звонок');
    expect(channelLabel('chat')).toBe('чат');
    expect(channelLabel('screenshot')).toBe('скриншот');
    expect(channelLabel('email')).toBe('почта');
    expect(channelLabel(null)).toBe('канал не указан');
  });

  it('делает номер инцидента из номера заявки', () => {
    expect(incidentNumber('2026-0415')).toBe('И-0415');
    expect(incidentNumber('З-7')).toBe('И-0007');
    expect(incidentNumber('без цифр')).toBe('И-0001');
  });
});
