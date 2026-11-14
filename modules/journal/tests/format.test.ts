import type { DictionaryItem, FieldDef, Ticket, User } from '@ugra/contracts';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_JOURNAL_FILTERS,
  actorLabel,
  diffPayload,
  eventGroups,
  eventTitle,
  filterEvents,
  fullTime,
  inPeriod,
  relativeTime,
  toJournalRows,
  topCorrectedFields,
  valueDiff,
} from '../web/format';

const NOW = new Date(2026, 10, 14, 12, 0, 0).getTime();

const USER = { id: 'u-1', fullName: 'Смирнова О.' } as unknown as User;
const TICKET = { id: 't-1', number: '0412' } as unknown as Ticket;
const FIELD = {
  key: 'department',
  label: 'Подразделение',
  type: 'dictionary',
  dictionary: 'department',
} as unknown as FieldDef;
const DICTIONARY = { dictionary: 'department', code: 'hr', label: 'Отдел кадров' } as unknown as DictionaryItem;

function event(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'e-1',
    type: 'ticket.field.corrected',
    at: new Date(NOW - 5 * 60_000).toISOString(),
    actor: { kind: 'user', id: 'u-1' },
    ticketId: 't-1',
    payload: {},
    ...overrides,
  };
}

describe('journal/format: actorLabel', () => {
  it('берёт имя из справочника и подписывает ИИ и систему', () => {
    expect(actorLabel(event({}), (id) => (id === 'u-1' ? 'Смирнова О.' : null))).toBe('Смирнова О.');
    expect(actorLabel(event({ actor: { kind: 'ai' } }))).toBe('ИИ');
    expect(actorLabel(event({ actor: { kind: 'system' } }))).toBe('система');
  });

  it('не падает на пустом или битом событии', () => {
    expect(actorLabel(null)).toBe('неизвестно');
    expect(actorLabel('мусор')).toBe('неизвестно');
    expect(actorLabel(event({ actor: { kind: 'user', id: 'u-9' } }))).toBe('человек');
    expect(actorLabel(event({ actor: { kind: 'robot' } }))).toBe('неизвестно');
  });
});

describe('journal/format: eventTitle', () => {
  const labels = {
    fieldLabel: (key: string) => (key === 'department' ? 'Подразделение' : null),
    userName: (id: string) => (id === 'u-2' ? 'Петров С. В.' : null),
  };

  it('разбирает правку поля, статус, аварию и массовый сбой', () => {
    expect(eventTitle(event({ payload: { fieldKey: 'department' } }), labels)).toBe(
      'Поле «Подразделение» исправлено',
    );
    expect(
      eventTitle(event({ type: 'ticket.status.changed', payload: { from: 'in_review', to: 'assigned' } }), labels),
    ).toBe('Статус: На проверке → Назначена');
    expect(eventTitle(event({ type: 'emergency.detected', payload: { level: 'confirmed' } }), labels)).toBe(
      'Авария подтверждена',
    );
    expect(
      eventTitle(event({ type: 'mass-incident.opened', payload: { number: '014', size: 4 } }), labels),
    ).toBe('Массовый сбой № 014: 4 заявок');
    expect(eventTitle(event({ type: 'ticket.confirmed', payload: { assigneeId: 'u-2' } }), labels)).toBe(
      'Заявка подтверждена',
    );
  });

  it('возвращает базовую подпись при пустом payload и неизвестном типе', () => {
    expect(eventTitle(event({ payload: null }))).toBe('Поле исправлено человеком');
    expect(eventTitle(event({ type: 'ticket.status.changed', payload: {} }))).toBe('Статус изменён');
    expect(eventTitle(event({ type: 'custom.thing', payload: {} }))).toBe('custom.thing');
    expect(eventTitle(undefined)).toBe('Событие');
  });
});

describe('journal/format: diffPayload', () => {
  it('читает previous → value, aiValue → value и from → to', () => {
    expect(diffPayload({ fieldKey: 'department', previous: 'Бухгалтерия', value: 'Отдел кадров' })).toEqual({
      fieldKey: 'department',
      before: 'Бухгалтерия',
      after: 'Отдел кадров',
    });
    expect(diffPayload({ fieldKey: 'priority', aiValue: 'medium', value: 'high' })).toEqual({
      fieldKey: 'priority',
      before: 'medium',
      after: 'high',
    });
    expect(diffPayload({ from: 'in_review', to: 'assigned' })).toEqual({
      fieldKey: null,
      before: 'in_review',
      after: 'assigned',
    });
  });

  it('возвращает null на пустом, битом и одинаковом payload', () => {
    expect(diffPayload(null)).toBeNull();
    expect(diffPayload(undefined)).toBeNull();
    expect(diffPayload([])).toBeNull();
    expect(diffPayload({})).toBeNull();
    expect(diffPayload({ previous: 'Отдел кадров', value: 'Отдел кадров' })).toBeNull();
  });

  it('числовые значения приводит к строке', () => {
    expect(diffPayload({ fieldKey: 'floor', previous: 2, value: 3 })).toEqual({
      fieldKey: 'floor',
      before: '2',
      after: '3',
    });
  });
});

describe('journal/format: valueDiff', () => {
  it('подсвечивает только отличающиеся слова', () => {
    const diff = valueDiff('Бухгалтерия', 'Отдел кадров');
    expect(diff.changed).toBe(true);
    expect(diff.before.every((segment) => segment.changed)).toBe(true);
    expect(diff.after.map((segment) => segment.text).join('')).toBe('Отдел кадров');
  });

  it('не подсвечивает совпавшее и переживает пустые значения', () => {
    const same = valueDiff('12', '12');
    expect(same.changed).toBe(false);
    expect(same.before[0]?.changed).toBe(false);

    const added = valueDiff(null, 'Высокий');
    expect(added.changed).toBe(true);
    expect(added.before).toEqual([]);
    expect(added.after.map((segment) => segment.text).join('')).toBe('Высокий');

    const removed = valueDiff('Средний', null);
    expect(removed.after).toEqual([]);
  });
});

describe('journal/format: относительное время', () => {
  it('пишет «только что», минуты, время сегодня и вчера', () => {
    expect(relativeTime(new Date(NOW - 10_000).toISOString(), NOW)).toBe('только что');
    expect(relativeTime(new Date(NOW - 5 * 60_000).toISOString(), NOW)).toBe('5 мин назад');
    expect(relativeTime(new Date(2026, 10, 14, 10, 44).toISOString(), NOW)).toBe('10:44');
    expect(relativeTime(new Date(2026, 10, 13, 16, 20).toISOString(), NOW)).toBe('вчера, 16:20');
  });

  it('для старых дат показывает день и месяц, битую — «—»', () => {
    expect(relativeTime(new Date(2026, 10, 8, 9, 0).toISOString(), NOW)).toBe('8 нояб.');
    expect(relativeTime('2025-01-05T09:00:00.000Z', NOW)).toMatch(/05\.01\.2025/);
    expect(relativeTime('не дата', NOW)).toBe('—');
    expect(relativeTime(null, NOW)).toBe('—');
  });

  it('точное время для подсказки', () => {
    expect(fullTime(new Date(2026, 10, 14, 10, 44).toISOString())).toBe('14.11.2026, 10:44');
    expect(fullTime('мусор')).toBe('');
    expect(fullTime(null)).toBe('');
  });
});

describe('journal/format: строки журнала', () => {
  const options = { users: [USER], tickets: [TICKET], fields: [FIELD], dictionaries: [DICTIONARY] };

  it('склеивает событие, автора, номер заявки и «было → стало» с подписями справочника', () => {
    const rows = toJournalRows(
      [
        event({
          payload: { fieldKey: 'department', previous: 'accounting', value: 'hr' },
        }),
      ],
      options,
    );
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.actor).toBe('Смирнова О.');
    expect(row?.ticketNumber).toBe('0412');
    expect(row?.fieldLabel).toBe('Подразделение');
    expect(row?.title).toBe('Поле «Подразделение» исправлено');
    expect(row?.diff?.before).toBe('accounting');
    expect(row?.diff?.after).toBe('Отдел кадров');
    expect(row?.diff?.changed).toBe(true);
    expect(row?.tone).toBe('warn');
  });

  it('сортирует новые события сверху и не падает на битых', () => {
    const rows = toJournalRows(
      [
        event({ id: 'old', at: new Date(NOW - 86_400_000).toISOString() }),
        event({ id: 'new', at: new Date(NOW - 60_000).toISOString() }),
        'мусор',
        event({ id: 'broken', at: 'не дата' }),
      ],
      options,
    );
    expect(rows.map((row) => row.id)).toEqual(['new', 'old', 'event-2', 'broken']);
    expect(rows[2]?.title).toBe('Событие');
    expect(rows[2]?.time).toBe(0);
  });

  it('без справочников показывает коды и «человек»', () => {
    const rows = toJournalRows([event({ payload: { fieldKey: 'department', previous: 'a', value: 'b' } })]);
    expect(rows[0]?.actor).toBe('человек');
    expect(rows[0]?.ticketNumber).toBeNull();
    expect(rows[0]?.fieldLabel).toBe('department');
  });
});

describe('journal/format: вкладки, фильтры и топ полей', () => {
  const options = { users: [USER], tickets: [TICKET], fields: [FIELD], dictionaries: [DICTIONARY] };
  const rows = toJournalRows(
    [
      event({ id: 'e-1', payload: { fieldKey: 'department', previous: 'a', value: 'b' } }),
      event({ id: 'e-2', payload: { fieldKey: 'department', previous: 'a', value: 'c' } }),
      event({ id: 'e-3', type: 'ticket.confirmed', payload: { assigneeId: 'u-1' } }),
      event({ id: 'e-4', type: 'emergency.detected', payload: { level: 'suspected' } }),
      event({ id: 'e-5', type: 'mass-incident.opened', payload: { number: '014', size: 3 } }),
      event({ id: 'e-6', type: 'analysis.completed', payload: { fields: ['category'] } }),
    ],
    options,
  );

  it('считает события на каждой вкладке', () => {
    expect(eventGroups(rows).map((group) => [group.id, group.count])).toEqual([
      ['all', 6],
      ['edits', 2],
      ['confirmations', 1],
      ['emergency', 2],
    ]);
    expect(eventGroups([])[0]?.count).toBe(0);
  });

  it('фильтрует по вкладке, периоду и поиску', () => {
    const filters = { ...DEFAULT_JOURNAL_FILTERS, period: 'week' as const };
    expect(filterEvents(rows, filters, NOW)).toHaveLength(6);
    expect(filterEvents(rows, { ...filters, group: 'edits' }, NOW)).toHaveLength(2);
    expect(filterEvents(rows, { ...filters, group: 'emergency' }, NOW)).toHaveLength(2);
    expect(filterEvents(rows, { ...filters, query: 'смирнова' }, NOW)).toHaveLength(6);
    expect(filterEvents(rows, { ...filters, query: 'отдел кадров' }, NOW)).toHaveLength(0);
    expect(filterEvents(rows, { ...filters, query: 'авар' }, NOW)).toHaveLength(1);
    expect(filterEvents([], filters, NOW)).toEqual([]);
  });

  it('«сегодня» отсекает вчерашние события', () => {
    const yesterday = toJournalRows([event({ at: new Date(NOW - 30 * 3_600_000).toISOString() })], options);
    expect(inPeriod(yesterday[0]?.time ?? 0, 'today', NOW)).toBe(false);
    expect(inPeriod(yesterday[0]?.time ?? 0, 'week', NOW)).toBe(true);
    expect(inPeriod(0, 'week', NOW)).toBe(false);
    expect(filterEvents(rows, { ...DEFAULT_JOURNAL_FILTERS, period: 'today' }, NOW)).toHaveLength(6);
  });

  it('строит топ-5 полей по правкам и переживает пустой список', () => {
    const top = topCorrectedFields(rows);
    expect(top).toHaveLength(1);
    expect(top[0]).toMatchObject({ fieldKey: 'department', label: 'Подразделение', count: 2, percent: 100 });
    expect(topCorrectedFields([])).toEqual([]);
  });

  it('ограничивает топ и считает проценты от всех правок', () => {
    const many = toJournalRows(
      [
        event({ id: 'a', payload: { fieldKey: 'department', previous: 'a', value: 'b' } }),
        event({ id: 'b', payload: { fieldKey: 'department', previous: 'a', value: 'b' } }),
        event({ id: 'c', payload: { fieldKey: 'priority', previous: 'a', value: 'b' } }),
      ],
      options,
    );
    const top = topCorrectedFields(many, 1);
    expect(top).toHaveLength(1);
    expect(top[0]?.percent).toBe(67);
  });
});
