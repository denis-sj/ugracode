import { describe, expect, it } from 'vitest';
import type { FieldDef, Ticket, TicketField } from '@ugra/contracts';
import {
  extractLocation,
  filterTickets,
  groupTicketFields,
  highlightQuotes,
  priorityReason,
  priorityTone,
  statusTone,
  toTimelineItems,
} from '../../../modules/dispatcher-review/web/format';

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

function ticketField(fieldKey: string, value: string | null, overrides: Partial<TicketField> = {}): TicketField {
  return {
    ticketId: 't-1',
    fieldKey,
    value,
    confidence: 0.8,
    quote: null,
    origin: 'text',
    needsReview: false,
    trace: [],
    aiValue: value,
    ...overrides,
  };
}

function fieldDef(key: string, label: string, group: FieldDef['group']): FieldDef {
  return { key, label, group, type: 'string', required: false, extractHint: '', evalMode: 'none' };
}

describe('filterTickets', () => {
  const tickets = [
    ticket({ id: '1', number: 'З-001', status: 'in_review', isEmergency: false, category: 'printer' }),
    ticket({ id: '2', number: 'З-002', status: 'assigned', isEmergency: true, category: 'network' }),
    ticket({ id: '3', number: 'З-003', status: 'closed', isEmergency: false, category: 'printer' }),
  ];

  it('пустая очередь остаётся пустой', () => {
    expect(filterTickets([], { status: 'all', onlyEmergency: false, query: '' })).toEqual([]);
  });

  it('фильтрует по статусу', () => {
    expect(filterTickets(tickets, { status: 'assigned', onlyEmergency: false, query: '' }).map((item) => item.id)).toEqual([
      '2',
    ]);
  });

  it('фильтрует по аварийности', () => {
    expect(filterTickets(tickets, { status: 'all', onlyEmergency: true, query: '' }).map((item) => item.id)).toEqual(['2']);
  });

  it('ищет по номеру и категории', () => {
    expect(filterTickets(tickets, { status: 'all', onlyEmergency: false, query: 'з-003' }).map((item) => item.id)).toEqual([
      '3',
    ]);
    expect(filterTickets(tickets, { status: 'all', onlyEmergency: false, query: 'printer' }).map((item) => item.id)).toEqual([
      '1',
      '3',
    ]);
  });
});

describe('highlightQuotes', () => {
  it('без текста — пусто', () => {
    expect(highlightQuotes('', ['312'])).toEqual([]);
  });

  it('без цитат — один обычный фрагмент', () => {
    expect(highlightQuotes('Принтер не печатает', [])).toEqual([{ text: 'Принтер не печатает', quote: false }]);
  });

  it('подсвечивает цитату и сохраняет регистр исходника', () => {
    expect(highlightQuotes('Принтер в 312 не печатает', ['312'])).toEqual([
      { text: 'Принтер в ', quote: false },
      { text: '312', quote: true },
      { text: ' не печатает', quote: false },
    ]);
  });

  it('объединяет пересекающиеся цитаты и игнорирует слишком короткие', () => {
    const segments = highlightQuotes('замятие бумаги в лотке', ['замятие бумаги', 'бумаги в', 'а']);
    expect(segments.filter((segment) => segment.quote).map((segment) => segment.text)).toEqual(['замятие бумаги в']);
  });

  it('если цитаты не найдены — текст не ломается', () => {
    expect(highlightQuotes('другой текст', ['нет такого'])).toEqual([{ text: 'другой текст', quote: false }]);
  });
});

describe('groupTicketFields', () => {
  const defs = [
    fieldDef('category', 'Категория', 'classification'),
    fieldDef('building', 'Корпус', 'location'),
    fieldDef('cabinet', 'Кабинет', 'location'),
    fieldDef('equipment', 'Оборудование', 'equipment'),
  ];

  it('на пустом реестре групп нет', () => {
    expect(groupTicketFields([ticketField('building', 'А')], [])).toEqual([]);
  });

  it('группирует поля и ставит «на проверку» первыми', () => {
    const groups = groupTicketFields(
      [
        ticketField('category', 'printer'),
        ticketField('building', 'А', { confidence: 0.95 }),
        ticketField('cabinet', null, { confidence: 0.2, needsReview: true }),
      ],
      defs,
    );
    expect(groups.map((group) => group.group)).toEqual(['classification', 'location', 'equipment']);
    expect(groups[1]?.fields.map((field) => field.key)).toEqual(['cabinet', 'building']);
    expect(groups[1]?.fields[0]?.field?.needsReview).toBe(true);
    expect(groups[2]?.fields[0]?.value).toBeNull();
  });
});

describe('extractLocation', () => {
  it('достаёт корпус и кабинет', () => {
    expect(extractLocation([ticketField('building', 'А'), ticketField('cabinet', '312')])).toEqual({
      building: 'А',
      cabinet: '312',
    });
  });

  it('пустые поля и отсутствие данных дают null', () => {
    expect(extractLocation([ticketField('building', null)])).toEqual({ building: null, cabinet: null });
    expect(extractLocation(null)).toEqual({ building: null, cabinet: null });
  });
});

describe('toTimelineItems', () => {
  it('пустой журнал — пустой список', () => {
    expect(toTimelineItems([])).toEqual([]);
  });

  it('переводит известные события и добавляет автора', () => {
    const items = toTimelineItems([
      {
        id: 'e-1',
        type: 'ticket.field.corrected',
        at: '2026-11-14T08:10:00.000Z',
        actor: { kind: 'user', id: 'u-1' },
        payload: { fieldKey: 'cabinet', value: '313' },
      },
    ]);
    expect(items[0]?.title).toBe('Поле исправлено человеком');
    expect(items[0]?.description).toContain('Человек');
    expect(items[0]?.description).toContain('cabinet: 313');
    expect(items[0]?.tone).toBe('warn');
  });

  it('неизвестное событие показывает свой тип и не падает', () => {
    const items = toTimelineItems([{ id: 'e-2', type: 'module.custom.event' }, 'не объект']);
    expect(items[0]?.title).toBe('module.custom.event');
    expect(items[1]?.title).toBe('Событие');
  });
});

describe('priorityReason', () => {
  it('для аварии объясняет срочность', () => {
    expect(priorityReason(ticket({ isEmergency: true }), [])).toContain('Авария');
  });

  it('собирает причину из влияния и срочности', () => {
    const reason = priorityReason(ticket(), [ticketField('impact', 'корпус'), ticketField('urgency', 'работа стоит')]);
    expect(reason).toContain('влияние — корпус');
    expect(reason).toContain('срочность — работа стоит');
  });

  it('переводит коды справочников в подписи', () => {
    const reason = priorityReason(
      ticket(),
      [ticketField('impact', 'group'), ticketField('urgency', 'down')],
      (key, value) => (key === 'impact' && value === 'group' ? 'Группа сотрудников' : 'Работа остановлена'),
    );
    expect(reason).toContain('Группа сотрудников');
    expect(reason).toContain('Работа остановлена');
    expect(reason).not.toContain('group');
  });

  it('без полей возвращает правило матрицы', () => {
    expect(priorityReason(ticket(), [])).toContain('матрицы');
  });
});

describe('tones', () => {
  it('подбирает цвет статуса и приоритета', () => {
    expect(statusTone('in_review')).toBe('warn');
    expect(statusTone('closed')).toBe('ok');
    expect(statusTone('cancelled')).toBe('muted');
    expect(priorityTone('emergency')).toBe('emergency');
    expect(priorityTone(null)).toBe('neutral');
  });
});
