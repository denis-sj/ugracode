import type { DictionaryItem, FieldDef, Ticket, User } from '@ugra/contracts';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_JOURNAL_FILTERS,
  actorLabel,
  actorSuffix,
  correctedCaption,
  correctedFieldLabel,
  correctedSummary,
  diffPayload,
  eventGroups,
  eventTitle,
  filterEvents,
  fullTime,
  inPeriod,
  isServiceEvent,
  pairLabel,
  plural,
  relativeTime,
  serviceEventCount,
  shortPersonName,
  shortTicketNumber,
  splitJournal,
  toJournalRows,
  topCorrectedFields,
  trainingExamples,
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

describe('journal/format: подписи автора, времени и номеров', () => {
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

  it('сокращает имя человека до «Имя Ф.»', () => {
    expect(shortPersonName('Ксения Нестерова')).toBe('Ксения Н.');
    expect(shortPersonName('  Иван   Петрович  Сидоров ')).toBe('Иван С.');
    expect(shortPersonName('Ксения')).toBe('Ксения');
    expect(shortPersonName('ИИ')).toBe('ИИ');
    expect(shortPersonName('   ')).toBe('Без имени');
  });

  it('сокращает номер заявки до последних четырёх знаков', () => {
    expect(shortTicketNumber('З-20261114-0001')).toBe('…0001');
    expect(shortTicketNumber('0412')).toBe('0412');
    expect(shortTicketNumber('  ')).toBe('');
  });

  it('подписывает автора строки и не повторяет его в заголовке', () => {
    const options = { users: [USER] };
    const [human] = toJournalRows(
      [event({ type: 'ticket.status.changed', payload: { from: 'in_review', to: 'cancelled' } })],
      options,
    );
    expect(actorSuffix(human!)).toBe('Смирнова О.');

    const [ai] = toJournalRows([event({ type: 'analysis.completed', actor: { kind: 'ai' } })] , options);
    expect(ai?.title).toBe('ИИ разобрал обращение');
    expect(actorSuffix(ai!)).toBeNull();

    const [system] = toJournalRows([event({ type: 'example.matched', actor: { kind: 'system' } })], options);
    expect(actorSuffix(system!)).toBe('система');
  });

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

  it('склоняет счётчики по-русски', () => {
    expect(plural(1, 'правка', 'правки', 'правок')).toBe('правка');
    expect(plural(2, 'правка', 'правки', 'правок')).toBe('правки');
    expect(plural(5, 'правка', 'правки', 'правок')).toBe('правок');
    expect(plural(11, 'правка', 'правки', 'правок')).toBe('правок');
    expect(plural(21, 'правка', 'правки', 'правок')).toBe('правка');
    expect(plural(23, 'правка', 'правки', 'правок')).toBe('правки');
    expect(plural(0, 'правка', 'правки', 'правок')).toBe('правок');
    expect(plural(Number.NaN, 'правка', 'правки', 'правок')).toBe('правок');
  });

  it('пишет «на N примерах» без ошибок склонения', () => {
    expect(trainingExamples(23)).toBe('на 23 примерах');
    expect(trainingExamples(21)).toBe('на 21 примере');
    expect(trainingExamples(11)).toBe('на 11 примерах');
    expect(trainingExamples(1)).toBe('на 1 примере');
    expect(trainingExamples(0)).toBe('на 0 примерах');
  });
});

describe('journal/format: eventTitle', () => {
  const labels = {
    fieldLabel: (key: string) => (key === 'department' ? 'Подразделение' : null),
    userName: (id: string) => (id === 'u-2' ? 'Петров С. В.' : null),
  };

  it('разбирает правку поля, подтверждение, аварию и массовый сбой', () => {
    expect(eventTitle(event({ payload: { fieldKey: 'department' } }), labels)).toBe(
      'Поле «Подразделение» исправлено',
    );
    expect(eventTitle(event({ type: 'emergency.detected', payload: { level: 'confirmed' } }), labels)).toBe(
      'Авария подтверждена',
    );
    expect(
      eventTitle(event({ type: 'mass-incident.opened', payload: { number: '014', size: 4 } }), labels),
    ).toBe('Массовый сбой № 014: 4 заявок');
    expect(eventTitle(event({ type: 'ticket.confirmed', payload: {} }), labels)).toBe('Заявка подтверждена');
    expect(eventTitle(event({ type: 'ticket.confirmed', payload: { assigneeId: 'u-2' } }), labels)).toBe(
      'Подтверждена и назначена',
    );
    expect(eventTitle(event({ type: 'ticket.assigned', payload: { assigneeId: 'u-2' } }), labels)).toBe(
      'Назначен исполнитель',
    );
  });

  it('не показывает машинные коды: ни типа события, ни ключа поля, ни статуса', () => {
    expect(eventTitle(event({ type: 'custom.thing', payload: {} }))).toBe('Событие');
    expect(eventTitle(event({ payload: { fieldKey: 'unknown_field' } }))).toBe('Поле исправлено человеком');
    expect(eventTitle(event({ payload: null }))).toBe('Поле исправлено человеком');
    expect(eventTitle(event({ type: 'ticket.status.changed', payload: {} }))).toBe('Статус изменён');
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

  it('без справочников показывает «человек» и «Поле» вместо машинного ключа', () => {
    const rows = toJournalRows([event({ payload: { fieldKey: 'department', previous: 'a', value: 'b' } })]);
    expect(rows[0]?.actor).toBe('человек');
    expect(rows[0]?.ticketNumber).toBeNull();
    expect(rows[0]?.fieldLabel).toBeNull();
    expect(correctedFieldLabel(rows[0]!)).toBe('Поле');
  });

  it('склеивает подтверждение и назначение одной заявки в одну строку', () => {
    const rows = toJournalRows(
      [
        event({ id: 'assigned-old', type: 'ticket.assigned', at: new Date(NOW - 3_600_000).toISOString() }),
        event({ id: 'confirmed', type: 'ticket.confirmed', at: new Date(NOW - 60_000).toISOString() }),
        event({ id: 'assigned-pair', type: 'ticket.assigned', at: new Date(NOW - 59_000).toISOString() }),
      ],
      options,
    );
    expect(rows.map((row) => row.id)).toEqual(['confirmed', 'assigned-old']);
  });

  it('оставляет «Назначен исполнитель», если подтверждения рядом нет', () => {
    const rows = toJournalRows([event({ id: 'assigned', type: 'ticket.assigned' })], options);
    expect(rows.map((row) => row.id)).toEqual(['assigned']);
  });

  it('подписывает подробности события: сколько полей собрал ИИ и какие признаки нашёл', () => {
    const rows = toJournalRows(
      [
        event({ id: 'a', type: 'analysis.completed', payload: { fields: ['category', 'priority'] } }),
        event({
          id: 'b',
          type: 'emergency.detected',
          payload: { level: 'suspected', signs: [{ quote: 'дым' }, { quote: 'запах гари' }] },
        }),
        event({ id: 'c', type: 'ticket.field.set', payload: { fieldKey: 'department', value: 'hr' } }),
        event({ id: 'd', type: 'ticket.confirmed', payload: { assigneeId: 'u-1' } }),
        event({ id: 'e', type: 'ticket.returned', payload: { from: 'in_review', reason: 'нет кабинета' } }),
      ],
      options,
    );
    expect(rows.find((row) => row.id === 'a')?.description).toBe('2 поля');
    expect(rows.find((row) => row.id === 'b')?.description).toBe('«дым», «запах гари»');
    expect(rows.find((row) => row.id === 'c')?.description).toBe('предложено: Отдел кадров');
    expect(rows.find((row) => row.id === 'd')?.description).toBe('исполнитель: Смирнова О.');
    expect(rows.find((row) => row.id === 'e')?.description).toBe('причина: нет кабинета');
  });
});

describe('journal/format: вкладки, служебные события и период', () => {
  const options = { users: [USER], tickets: [TICKET], fields: [FIELD], dictionaries: [DICTIONARY] };
  const rows = toJournalRows(
    [
      event({ id: 'e-1', payload: { fieldKey: 'department', previous: 'a', value: 'b' } }),
      event({ id: 'e-2', payload: { fieldKey: 'department', previous: 'a', value: 'c' } }),
      event({ id: 'e-3', type: 'ticket.confirmed', payload: { assigneeId: 'u-1' } }),
      event({ id: 'e-4', type: 'emergency.detected', payload: { level: 'suspected' } }),
      event({ id: 'e-5', type: 'mass-incident.opened', payload: { number: '014', size: 3 } }),
      event({ id: 'e-6', type: 'analysis.completed', payload: { fields: ['category'] } }),
      event({ id: 'e-7', type: 'analysis.step.completed', payload: { step: 'classify' } }),
      event({ id: 'e-8', type: 'agent.step', payload: { tool: 'kb.search' } }),
      event({ id: 'e-9', type: 'report-kb-gaps.miss', payload: {} }),
      event({ id: 'e-10', type: 'ticket.field.set', payload: { fieldKey: 'department', value: 'hr' } }),
    ],
    options,
  );

  it('считает события на каждой вкладке, не считая служебные', () => {
    expect(eventGroups(rows).map((group) => [group.id, group.count])).toEqual([
      ['all', 6],
      ['edits', 2],
      ['confirmations', 1],
      ['emergency', 2],
    ]);
    expect(eventGroups([])[0]?.count).toBe(0);
  });

  it('узнаёт служебные шаги и не пускает их в список', () => {
    expect(rows.filter((row) => isServiceEvent(row)).map((row) => row.id).sort()).toEqual([
      'e-10',
      'e-7',
      'e-8',
      'e-9',
    ]);
    const filters = { ...DEFAULT_JOURNAL_FILTERS, period: 'week' as const };
    expect(filterEvents(rows, filters, NOW)).toHaveLength(6);
    expect(filterEvents(rows, filters, NOW).some((row) => row.type === 'agent.step')).toBe(false);
    expect(filterEvents(rows, filters, NOW).some((row) => row.type === 'ticket.field.set')).toBe(false);
    expect(serviceEventCount(rows, 'week', NOW)).toBe(4);
    expect(serviceEventCount(rows, 'today', NOW)).toBe(4);
  });

  it('прячет технические смены статуса пайплайна, но оставляет решения диспетчера', () => {
    const statuses = toJournalRows(
      [
        event({ id: 'p1', type: 'ticket.status.changed', payload: { from: 'new', to: 'ai_draft' } }),
        event({ id: 'p2', type: 'ticket.status.changed', payload: { from: 'ai_draft', to: 'in_review' } }),
        event({ id: 'h1', type: 'ticket.status.changed', payload: { from: 'in_review', to: 'cancelled' } }),
      ],
      options,
    );
    expect(statuses.filter((row) => isServiceEvent(row)).map((row) => row.id)).toEqual(['p1', 'p2']);
    expect(filterEvents(statuses, { group: 'all', period: 'week' }, NOW).map((row) => row.id)).toEqual(['h1']);
    expect(filterEvents(statuses, { group: 'confirmations', period: 'week' }, NOW)).toEqual([]);
  });

  it('фильтрует по вкладке и периоду', () => {
    const filters = { ...DEFAULT_JOURNAL_FILTERS, period: 'week' as const };
    expect(filterEvents(rows, { ...filters, group: 'edits' }, NOW)).toHaveLength(2);
    expect(filterEvents(rows, { ...filters, group: 'emergency' }, NOW)).toHaveLength(2);
    expect(filterEvents(rows, { ...filters, group: 'confirmations' }, NOW)).toHaveLength(1);
    expect(filterEvents([], filters, NOW)).toEqual([]);
  });

  it('«сегодня» отсекает вчерашние события', () => {
    const yesterday = toJournalRows([event({ at: new Date(NOW - 30 * 3_600_000).toISOString() })], options);
    expect(inPeriod(yesterday[0]?.time ?? 0, 'today', NOW)).toBe(false);
    expect(inPeriod(yesterday[0]?.time ?? 0, 'week', NOW)).toBe(true);
    expect(inPeriod(0, 'week', NOW)).toBe(false);
    expect(filterEvents(rows, { ...DEFAULT_JOURNAL_FILTERS, period: 'today' }, NOW)).toHaveLength(6);
  });

  it('делит события на правки сверху и остальные, ничего не теряя', () => {
    const feed = splitJournal(filterEvents(rows, { group: 'all', period: 'week' }, NOW), 4);
    expect(feed.fixes).toHaveLength(2);
    expect(feed.hiddenFixes).toBe(0);
    expect(feed.rest).toHaveLength(4);
    expect(feed.fixes.length + feed.rest.length).toBe(6);
  });

  it('лишние правки уходят в остальные события и считаются', () => {
    const many = toJournalRows(
      Array.from({ length: 6 }, (_unused, index) =>
        event({ id: `c-${index}`, payload: { fieldKey: 'department', previous: 'a', value: 'b' } }),
      ),
      options,
    );
    const feed = splitJournal(many, 4);
    expect(feed.fixes.map((row) => row.id)).toEqual(['c-0', 'c-1', 'c-2', 'c-3']);
    expect(feed.hiddenFixes).toBe(2);
    expect(feed.rest.map((row) => row.id)).toEqual(['c-4', 'c-5']);
    expect(splitJournal([]).fixes).toEqual([]);
  });
});

describe('journal/format: «Что чаще исправляют»', () => {
  const options = { users: [USER], tickets: [TICKET], fields: [FIELD], dictionaries: [DICTIONARY] };

  it('строит топ-5 полей по правкам и переживает пустой список', () => {
    const rows = toJournalRows(
      [
        event({ id: 'e-1', payload: { fieldKey: 'department', previous: 'a', value: 'b' } }),
        event({ id: 'e-2', payload: { fieldKey: 'department', previous: 'a', value: 'c' } }),
      ],
      options,
    );
    const top = topCorrectedFields(rows);
    expect(top).toHaveLength(1);
    expect(top[0]).toMatchObject({ fieldKey: 'department', label: 'Подразделение', count: 2, percent: 100 });
    expect(topCorrectedFields([])).toEqual([]);
  });

  it('ограничивает топ, считает проценты и длину полоски от самого частого поля', () => {
    const many = toJournalRows(
      [
        event({ id: 'a', payload: { fieldKey: 'department', previous: 'a', value: 'b' } }),
        event({ id: 'b', payload: { fieldKey: 'department', previous: 'a', value: 'b' } }),
        event({ id: 'c', payload: { fieldKey: 'department', previous: 'a', value: 'b' } }),
        event({ id: 'd', payload: { fieldKey: 'priority', previous: 'a', value: 'b' } }),
      ],
      options,
    );
    const top = topCorrectedFields(many, 1);
    expect(top).toHaveLength(1);
    expect(top[0]?.percent).toBe(75);
    expect(top[0]?.share).toBe(100);

    const two = topCorrectedFields(many, 2);
    expect(two[1]?.share).toBe(33);
  });

  it('запоминает самую частую пару «было → стало» у поля', () => {
    const rows = toJournalRows(
      [
        event({ id: 'a', payload: { fieldKey: 'department', previous: 'accounting', value: 'hr' } }),
        event({ id: 'b', payload: { fieldKey: 'department', previous: 'accounting', value: 'hr' } }),
        event({ id: 'c', payload: { fieldKey: 'department', previous: 'it', value: 'hr' } }),
      ],
      options,
    );
    const [field] = topCorrectedFields(rows);
    expect(field?.pair).toEqual({ before: 'accounting', after: 'Отдел кадров' });
    expect(pairLabel(field?.pair ?? null)).toBe('accounting ↔ Отдел кадров');
  });

  it('подписывает пару без одного из значений и пустую пару', () => {
    expect(pairLabel({ before: null, after: 'МФУ' })).toBe('добавляли «МФУ»');
    expect(pairLabel({ before: 'Принтер', after: null })).toBe('убирали «Принтер»');
    expect(pairLabel({ before: null, after: null })).toBeNull();
    expect(pairLabel(null)).toBeNull();
  });

  it('считает правки и поля, которые заполнил ИИ', () => {
    const rows = toJournalRows(
      [
        event({ id: 'c-1' }),
        event({ id: 'c-2' }),
        event({ id: 's-1', type: 'ticket.field.set' }),
        event({ id: 's-2', type: 'ticket.field.set' }),
        event({ id: 's-3', type: 'ticket.field.set' }),
      ],
      options,
    );
    expect(correctedSummary(rows, 'week', NOW)).toEqual({ corrections: 2, aiFields: 3 });
    expect(correctedSummary([], 'week', NOW)).toEqual({ corrections: 0, aiFields: 0 });
    expect(correctedSummary(rows, 'today', NOW)).toEqual({ corrections: 2, aiFields: 3 });
  });

  it('не считает в сводку события вне периода', () => {
    const rows = toJournalRows(
      [
        event({ id: 'old', at: new Date(NOW - 10 * 86_400_000).toISOString() }),
        event({ id: 'new', at: new Date(NOW - 60_000).toISOString() }),
      ],
      options,
    );
    expect(correctedSummary(rows, 'week', NOW)).toEqual({ corrections: 1, aiFields: 0 });
  });

  it('собирает подпись «За 7 дней — N правок из M полей»', () => {
    expect(correctedCaption({ corrections: 23, aiFields: 412 }, 'week')).toBe(
      'За 7 дней — 23 правки из 412 полей',
    );
    expect(correctedCaption({ corrections: 1, aiFields: 1 }, 'today')).toBe('За сегодня — 1 правка из 1 поля');
    expect(correctedCaption({ corrections: 2, aiFields: 0 }, 'week')).toBe('За 7 дней — 2 правки');
  });

  it('называет поле правки без машинного ключа', () => {
    const rows = toJournalRows([event({ payload: { fieldKey: 'department' } })], options);
    expect(correctedFieldLabel(rows[0]!)).toBe('Подразделение');
    const unknown = toJournalRows([event({ payload: { fieldKey: 'mystery' } })], options);
    expect(correctedFieldLabel(unknown[0]!)).toBe('Поле');
  });
});
