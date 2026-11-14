import { describe, expect, it } from 'vitest';
import type { Ticket, TicketField } from '@ugra/contracts';
import {
  deadline,
  diffValues,
  filterJournal,
  formatDuration,
  JOURNAL_ALL,
  journalRows,
  journalTypes,
  lastReturn,
  overdueCount,
  priorityRank,
  reviewFieldKeys,
  sortTickets,
  ticketDeadlines,
  ticketDueTime,
} from '../web/format';

const NOW = Date.parse('2026-11-14T10:00:00.000Z');

function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 't-1',
    number: 'З-001',
    appealId: 'a-1',
    status: 'in_review',
    priority: 'medium',
    category: 'printer',
    departmentId: 'dep-it',
    assigneeId: null,
    isEmergency: false,
    incidentId: null,
    reactDueAt: null,
    slaDueAt: null,
    equipmentId: null,
    locationId: null,
    confirmedBy: null,
    confirmedAt: null,
    createdAt: '2026-11-14T08:00:00.000Z',
    updatedAt: '2026-11-14T08:00:00.000Z',
    ...overrides,
  };
}

function ticketField(fieldKey: string, overrides: Partial<TicketField> = {}): TicketField {
  return {
    ticketId: 't-1',
    fieldKey,
    value: 'x',
    confidence: 0.9,
    quote: null,
    origin: 'text',
    needsReview: false,
    trace: [],
    aiValue: 'x',
    ...overrides,
  };
}

function minutesFromNow(minutes: number): string {
  return new Date(NOW + minutes * 60_000).toISOString();
}

describe('sortTickets', () => {
  it('пустая очередь остаётся пустой', () => {
    expect(sortTickets([])).toEqual([]);
  });

  it('авария и критическая — выше остальных', () => {
    const queue = [
      ticket({ id: 'low', number: 'З-001', priority: 'low' }),
      ticket({ id: 'critical', number: 'З-002', priority: 'critical' }),
      ticket({ id: 'emergency', number: 'З-003', priority: 'high', isEmergency: true }),
      ticket({ id: 'medium', number: 'З-004', priority: 'medium' }),
    ];
    expect(sortTickets(queue).map((item) => item.id)).toEqual(['emergency', 'critical', 'medium', 'low']);
  });

  it('при равном приоритете сверху тот, у кого срок раньше, а заявки без срока — в конце', () => {
    const queue = [
      ticket({ id: 'none', priority: 'medium' }),
      ticket({ id: 'later', priority: 'medium', slaDueAt: minutesFromNow(120) }),
      ticket({ id: 'sooner', priority: 'medium', slaDueAt: minutesFromNow(15) }),
    ];
    expect(sortTickets(queue).map((item) => item.id)).toEqual(['sooner', 'later', 'none']);
  });

  it('просроченная заявка идёт раньше непросроченной того же приоритета', () => {
    const queue = [
      ticket({ id: 'fresh', priority: 'high', slaDueAt: minutesFromNow(60) }),
      ticket({ id: 'overdue', priority: 'high', slaDueAt: minutesFromNow(-30) }),
    ];
    expect(sortTickets(queue)[0]?.id).toBe('overdue');
  });

  it('ближайший срок берётся из реакции и решения', () => {
    expect(ticketDueTime(ticket({ reactDueAt: minutesFromNow(5), slaDueAt: minutesFromNow(90) }))).toBe(
      NOW + 5 * 60_000,
    );
    expect(ticketDueTime(ticket())).toBe(Number.POSITIVE_INFINITY);
  });

  it('битые даты не ломают сортировку и не считаются сроком', () => {
    expect(ticketDueTime(ticket({ reactDueAt: 'не дата', slaDueAt: null }))).toBe(Number.POSITIVE_INFINITY);
    const queue = [ticket({ id: 'bad', slaDueAt: 'не дата' }), ticket({ id: 'ok', slaDueAt: minutesFromNow(10) })];
    expect(sortTickets(queue)[0]?.id).toBe('ok');
  });

  it('при полностью равных данных порядок стабильный: старые заявки раньше', () => {
    const queue = [
      ticket({ id: 'new', number: 'З-002', createdAt: '2026-11-14T09:00:00.000Z' }),
      ticket({ id: 'old', number: 'З-001', createdAt: '2026-11-14T07:00:00.000Z' }),
    ];
    expect(sortTickets(queue).map((item) => item.id)).toEqual(['old', 'new']);
  });

  it('не меняет исходный массив и учитывает аварию в ранге', () => {
    const queue = [ticket({ id: 'plain' }), ticket({ id: 'emergency', isEmergency: true })];
    const copy = [...queue];
    sortTickets(queue);
    expect(queue).toEqual(copy);
    expect(priorityRank({ priority: 'low', isEmergency: true })).toBe(0);
    expect(priorityRank({ priority: null, isEmergency: false })).toBe(5);
  });
});

describe('formatDuration', () => {
  it('меньше минуты и нулевые значения', () => {
    expect(formatDuration(0)).toBe('< 1 мин');
    expect(formatDuration(30_000)).toBe('< 1 мин');
  });

  it('минуты, часы и дни', () => {
    expect(formatDuration(12 * 60_000)).toBe('12 мин');
    expect(formatDuration(2 * 3_600_000)).toBe('2 ч');
    expect(formatDuration(2 * 3_600_000 + 15 * 60_000)).toBe('2 ч 15 мин');
    expect(formatDuration(3 * 86_400_000 + 4 * 3_600_000)).toBe('3 д 4 ч');
    expect(formatDuration(86_400_000)).toBe('1 д');
  });

  it('отрицательное время показывается по модулю, мусор — прочерком', () => {
    expect(formatDuration(-12 * 60_000)).toBe('12 мин');
    expect(formatDuration(Number.NaN)).toBe('—');
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('deadline / ticketDeadlines', () => {
  it('нет срока или дата битая — срока нет', () => {
    expect(deadline('sla', null, NOW)).toBeNull();
    expect(deadline('react', 'не дата', NOW)).toBeNull();
    expect(ticketDeadlines(ticket(), NOW)).toEqual([]);
  });

  it('осталось время: подпись и цвет', () => {
    const item = deadline('react', minutesFromNow(42), NOW);
    expect(item?.label).toBe('реакция');
    expect(item?.text).toBe('42 мин');
    expect(item?.overdue).toBe(false);
    expect(item?.tone).toBe('neutral');
  });

  it('меньше 15 минут — предупреждение', () => {
    expect(deadline('sla', minutesFromNow(10), NOW)?.tone).toBe('warn');
  });

  it('просрочка: текст, признак и красный тон', () => {
    const item = deadline('sla', minutesFromNow(-5), NOW);
    expect(item?.overdue).toBe(true);
    expect(item?.text).toBe('просрочено 5 мин');
    expect(item?.tone).toBe('danger');
    expect(item?.minutes).toBe(5);
  });

  it('ровно сейчас — ещё не просрочено', () => {
    const item = deadline('sla', new Date(NOW).toISOString(), NOW);
    expect(item?.overdue).toBe(false);
    expect(item?.text).toBe('< 1 мин');
  });

  it('оба срока собираются по порядку и считают просроченные заявки', () => {
    const full = ticket({ reactDueAt: minutesFromNow(30), slaDueAt: minutesFromNow(-1) });
    expect(ticketDeadlines(full, NOW).map((item) => item.kind)).toEqual(['react', 'sla']);
    expect(overdueCount([full, ticket(), ticket({ slaDueAt: minutesFromNow(-10) })], NOW)).toBe(2);
    expect(overdueCount([], NOW)).toBe(0);
  });
});

describe('diffValues', () => {
  it('одинаковые значения — без изменений', () => {
    const diff = diffValues('312', '312');
    expect(diff.changed).toBe(false);
    expect(diff.before).toEqual([{ text: '312', changed: false }]);
  });

  it('оба пустые — тоже без изменений', () => {
    expect(diffValues(null, null)).toEqual({ before: [], after: [], changed: false });
  });

  it('ИИ не предлагал, человек заполнил', () => {
    const diff = diffValues(null, '313');
    expect(diff.changed).toBe(true);
    expect(diff.before).toEqual([]);
    expect(diff.after.map((segment) => segment.text).join('')).toBe('313');
  });

  it('подсвечивает только отличающийся фрагмент', () => {
    const diff = diffValues('Корпус Б кабинет 312', 'Корпус Б кабинет 313');
    expect(diff.changed).toBe(true);
    expect(diff.before.filter((segment) => segment.changed).map((segment) => segment.text).join('')).toBe('312');
    expect(diff.after.filter((segment) => segment.changed).map((segment) => segment.text).join('')).toBe('313');
    expect(diff.before.map((segment) => segment.text).join('')).toBe('Корпус Б кабинет 312');
  });

  it('очищенное человеком значение', () => {
    const diff = diffValues('Бухгалтерия', null);
    expect(diff.after).toEqual([]);
    expect(diff.changed).toBe(true);
  });
});

describe('journalRows', () => {
  const corrected = {
    id: 'e-1',
    type: 'ticket.field.corrected',
    at: '2026-11-14T10:00:00.000Z',
    actor: { kind: 'user', id: 'u-1' },
    payload: { fieldKey: 'cabinet', previous: '312', value: '313' },
  };
  const confirmed = {
    id: 'e-2',
    type: 'ticket.confirmed',
    at: '2026-11-14T10:05:00.000Z',
    actor: { kind: 'user', id: 'u-1' },
    payload: { assigneeId: 'u-2' },
  };

  it('пустой журнал — пустой список', () => {
    expect(journalRows([])).toEqual([]);
  });

  it('правка поля даёт пару «ИИ → человек» и подпись поля', () => {
    const rows = journalRows([corrected], {
      fieldLabel: (key) => (key === 'cabinet' ? 'Кабинет' : key),
      actorName: (id) => (id === 'u-1' ? 'Анна Миронова' : null),
    });
    expect(rows[0]?.title).toBe('Поле исправлено человеком');
    expect(rows[0]?.fieldLabel).toBe('Кабинет');
    expect(rows[0]?.author).toBe('Анна Миронова');
    expect(rows[0]?.diff?.changed).toBe(true);
    expect(rows[0]?.description).toBeUndefined();
  });

  it('подписи справочников подставляются до сравнения', () => {
    const rows = journalRows([corrected], {
      formatValue: (_key, value) => (value === '312' ? 'Каб. 312' : value === '313' ? 'Каб. 313' : value),
    });
    expect(rows[0]?.diff?.before.map((segment) => segment.text).join('')).toBe('Каб. 312');
  });

  it('события новее — выше, тип и автор на месте', () => {
    const rows = journalRows([corrected, confirmed]);
    expect(rows.map((row) => row.id)).toEqual(['e-2', 'e-1']);
    expect(rows[0]?.title).toBe('Заявка подтверждена');
    expect(rows[0]?.actorKind).toBe('user');
    expect(rows[0]?.description).toContain('u-2');
    expect(rows[0]?.diff).toBeNull();
  });

  it('неизвестные события и мусор не роняют журнал', () => {
    const rows = journalRows([{ id: 'x', type: 'module.custom.event' }, 'не объект']);
    expect(rows[0]?.title).toBe('module.custom.event');
    expect(rows[1]?.title).toBe('Событие');
    expect(rows[1]?.author).toBe('Неизвестно');
  });

  it('типы событий и фильтр по типу', () => {
    const rows = journalRows([corrected, confirmed]);
    const types = journalTypes(rows);
    expect(types.map((option) => option.type).sort()).toEqual(['ticket.confirmed', 'ticket.field.corrected']);
    expect(filterJournal(rows, JOURNAL_ALL)).toHaveLength(2);
    expect(filterJournal(rows, 'ticket.field.corrected').map((row) => row.id)).toEqual(['e-1']);
    expect(filterJournal(rows, 'ticket.returned')).toEqual([]);
  });
});

describe('lastReturn', () => {
  const returned = (id: string, at: string, reason?: string) => ({
    id,
    type: 'ticket.returned',
    at,
    actor: { kind: 'user', id: 'u-9' },
    payload: reason === undefined ? { from: 'in_progress' } : { from: 'in_progress', reason },
  });

  it('возвратов не было — плашки нет', () => {
    expect(lastReturn([])).toBeNull();
    expect(lastReturn([{ type: 'ticket.confirmed', at: '2026-11-14T10:00:00.000Z' }])).toBeNull();
  });

  it('берёт причину, автора и время возврата', () => {
    const info = lastReturn([returned('e-1', '2026-11-14T09:00:00.000Z', 'Нужен доступ в кабинет')], {
      actorName: () => 'Пётр Инженеров',
    });
    expect(info?.reason).toBe('Нужен доступ в кабинет');
    expect(info?.author).toBe('Пётр Инженеров');
    expect(info?.from).toBe('in_progress');
  });

  it('последний возврат — по времени, а не по порядку в списке', () => {
    const info = lastReturn([
      returned('new', '2026-11-14T10:00:00.000Z', 'Вторая причина'),
      returned('old', '2026-11-14T08:00:00.000Z', 'Первая причина'),
    ]);
    expect(info?.reason).toBe('Вторая причина');
  });

  it('без причины возврат всё равно находится', () => {
    const info = lastReturn([returned('e-1', '2026-11-14T09:00:00.000Z')]);
    expect(info).not.toBeNull();
    expect(info?.reason).toBeNull();
  });
});

describe('reviewFieldKeys', () => {
  it('Tab ходит только по спорным полям в порядке реестра', () => {
    const keys = reviewFieldKeys([
      { fields: [{ key: 'category', field: ticketField('category') }] },
      {
        fields: [
          { key: 'cabinet', field: ticketField('cabinet', { needsReview: true }) },
          { key: 'building', field: ticketField('building') },
          { key: 'floor', field: null },
        ],
      },
    ]);
    expect(keys).toEqual(['cabinet']);
  });

  it('нет спорных полей — пустой список', () => {
    expect(reviewFieldKeys([])).toEqual([]);
    expect(reviewFieldKeys([{ fields: [{ key: 'a', field: ticketField('a') }] }])).toEqual([]);
  });
});
