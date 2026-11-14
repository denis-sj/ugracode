import { describe, expect, it } from 'vitest';
import type { Ticket, TicketField } from '@ugra/contracts';
import {
  analysisEmergency,
  candidatePercent,
  DEFAULT_FILTERS,
  deadline,
  diffValues,
  fieldDisplayValue,
  filledFieldCount,
  filterJournal,
  filterTickets,
  formatDuration,
  formatLocation,
  JOURNAL_ALL,
  journalRows,
  journalTypes,
  lastReturn,
  locationFromTicket,
  overdueCount,
  priorityRank,
  promoteNew,
  queueAction,
  queueEventAction,
  queueFiltersFromQuery,
  queueSummary,
  replyTemplate,
  reviewFieldKeys,
  reviewHref,
  reviewTicketId,
  sortTickets,
  ticketDeadlines,
  ticketDueTime,
  ticketSignals,
  ticketTitleFromFields,
  traceSteps,
  visibleReviewGroups,
  waitingLabel,
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

describe('ticketSignals и быстрые фильтры', () => {
  it('уверенность — по самому слабому заполненному полю, спорные считаются', () => {
    const signals = ticketSignals([
      ticketField('a', { confidence: 0.94 }),
      ticketField('b', { confidence: 0.52, needsReview: true }),
      ticketField('c', { value: null, confidence: 0.1 }),
    ]);
    expect(signals).toEqual({ review: 1, confidence: 0.52 });
  });

  it('пустые поля не дают ложного нуля', () => {
    expect(ticketSignals([])).toEqual({ review: 0, confidence: null });
    expect(ticketSignals([ticketField('a', { value: null, confidence: 0 })])).toEqual({
      review: 0,
      confidence: null,
    });
  });

  it('сомнительные — спорные поля или уверенность ниже 75 %', () => {
    const queue = [
      ticket({ id: 'ok', status: 'in_review' }),
      ticket({ id: 'low', status: 'in_review' }),
      ticket({ id: 'review', status: 'in_review' }),
      ticket({ id: 'emergency', isEmergency: true }),
      ticket({ id: 'waiting', status: 'waiting_applicant' }),
    ];
    const context = {
      signals: {
        ok: { review: 0, confidence: 0.9 },
        low: { review: 0, confidence: 0.4 },
        review: { review: 2, confidence: 0.95 },
      },
    };
    expect(filterTickets(queue, { ...DEFAULT_FILTERS, bucket: 'suspicious' }, context).map((item) => item.id)).toEqual([
      'low',
      'review',
    ]);
    expect(filterTickets(queue, { ...DEFAULT_FILTERS, bucket: 'ready' }, context).map((item) => item.id)).toEqual(['ok']);
    expect(filterTickets(queue, { ...DEFAULT_FILTERS, bucket: 'ready' }).map((item) => item.id)).toEqual([]);
    expect(filterTickets(queue, { ...DEFAULT_FILTERS, bucket: 'emergency' }, context).map((item) => item.id)).toEqual([
      'emergency',
    ]);
  });

  it('без явного статуса очередь не показывает закрытые и решённые', () => {
    const queue = [
      ticket({ id: 'open', status: 'in_review' }),
      ticket({ id: 'closed', status: 'closed' }),
      ticket({ id: 'cancelled', status: 'cancelled' }),
      ticket({ id: 'resolved', status: 'resolved' }),
    ];
    expect(filterTickets(queue, DEFAULT_FILTERS).map((item) => item.id)).toEqual(['open']);
    expect(
      filterTickets(queue, { ...DEFAULT_FILTERS, status: 'closed' }).map((item) => item.id),
    ).toEqual(['closed']);
  });

  it('статус, исполнитель и поиск по месту сочетаются', () => {
    const queue = [
      ticket({ id: 'a', status: 'in_review', assigneeId: 'u-1' }),
      ticket({ id: 'b', status: 'in_review', assigneeId: 'u-2' }),
      ticket({ id: 'c', status: 'assigned', assigneeId: 'u-1' }),
    ];
    const context = { locations: { a: 'Корпус Б · кабинет 312' } };
    expect(
      filterTickets(queue, { ...DEFAULT_FILTERS, status: 'in_review', assignee: 'u-1' }, context).map((item) => item.id),
    ).toEqual(['a']);
    expect(filterTickets(queue, { ...DEFAULT_FILTERS, query: '312' }, context).map((item) => item.id)).toEqual(['a']);
    expect(filterTickets(queue, { ...DEFAULT_FILTERS, assignee: 'u-2' }, context).map((item) => item.id)).toEqual(['b']);
  });
});

describe('query из hash', () => {
  it('очередь читает статус, аварии и исполнителя', () => {
    const filters = queueFiltersFromQuery(new URLSearchParams('status=in_review&emergency=true&assignee=u-1'));
    expect(filters.status).toBe('in_review');
    expect(filters.onlyEmergency).toBe(true);
    expect(filters.assignee).toBe('u-1');
  });

  it('неизвестный статус и пустой query дают фильтры по умолчанию', () => {
    expect(queueFiltersFromQuery(new URLSearchParams('status=что-то'))).toEqual(DEFAULT_FILTERS);
    expect(queueFiltersFromQuery(new URLSearchParams(''))).toEqual(DEFAULT_FILTERS);
    expect(queueFiltersFromQuery(new URLSearchParams('emergency=0')).onlyEmergency).toBe(false);
  });

  it('review берёт id и собирает ссылку обратно', () => {
    expect(reviewTicketId(new URLSearchParams('id=t-42'))).toBe('t-42');
    expect(reviewTicketId(new URLSearchParams('id='))).toBeNull();
    expect(reviewTicketId(new URLSearchParams(''))).toBeNull();
    expect(reviewHref('t 42')).toBe('/review?id=t%2042');
  });
});

describe('события очереди', () => {
  const known = new Set(['t-1']);

  it('известная заявка — обновление, неизвестная — новая', () => {
    expect(queueEventAction({ ticketId: 't-1', type: 'ticket.status.changed' }, known)).toBe('updated');
    expect(queueEventAction({ ticketId: 't-2', type: 'ticket.status.changed' }, known)).toBe('new');
  });

  it('событие без заявки и мусор игнорируются', () => {
    expect(queueEventAction({ type: 'appeal.created', payload: { appealId: 'a-1' } }, known)).toBe('ignored');
    expect(queueEventAction({ ticketId: '' }, known)).toBe('ignored');
    expect(queueEventAction(null, known)).toBe('ignored');
    expect(queueEventAction('строка', known)).toBe('ignored');
  });

  it('неизвестный тип события с заявкой всё равно обновляет строку', () => {
    expect(queueEventAction({ ticketId: 't-1', type: 'module.custom.event' }, known)).toBe('updated');
  });
});

describe('сводка и «что сделать»', () => {
  it('новые строки поднимаются наверх, остальные не меняются', () => {
    const queue = [ticket({ id: 'a' }), ticket({ id: 'b' }), ticket({ id: 'c' })];
    expect(promoteNew(queue, new Set(['c'])).map((item) => item.id)).toEqual(['c', 'a', 'b']);
    expect(promoteNew(queue, new Set()).map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('сводка считает проверку, ожидание, аварии и смену', () => {
    const summary = queueSummary(
      [
        ticket({ id: 'a', status: 'in_review' }),
        ticket({ id: 'b', status: 'waiting_applicant' }),
        ticket({ id: 'c', isEmergency: true }),
        ticket({ id: 'd', createdAt: new Date(NOW - 86_400_000).toISOString() }),
      ],
      NOW,
    );
    expect(summary).toEqual({ review: 3, waiting: 1, emergency: 1, perShift: 3 });
  });

  it('«ждёт» считается от создания', () => {
    expect(waitingLabel(new Date(NOW - 5 * 60_000).toISOString(), NOW)).toBe('5 мин');
    expect(waitingLabel('не дата', NOW)).toBe('—');
  });

  it('«что сделать» отвечает на состояние заявки', () => {
    expect(queueAction(ticket({ isEmergency: true }), undefined)).toEqual({
      text: 'Авария · дежурный уведомлён',
      tone: 'danger',
    });
    expect(queueAction(ticket({ status: 'waiting_applicant' }), undefined).text).toBe('Ждёт ответа заявителя');
    expect(
      queueAction(ticket({ status: 'in_review' }), { review: 2, confidence: 0.5 }),
    ).toEqual({ text: 'Проверить 2 поля', tone: 'warn' });
    expect(
      queueAction(ticket({ status: 'in_review' }), { review: 0, confidence: 0.5 }),
    ).toEqual({ text: 'Проверить сомнительные поля', tone: 'warn' });
    expect(queueAction(ticket({ status: 'in_review' }), { review: 0, confidence: 0.9 })).toEqual({
      text: 'Готова к подтверждению',
      tone: 'ok',
    });
    expect(queueAction(ticket({ status: 'assigned' }), undefined).text).toBe('Назначена · ждёт инженера');
    expect(queueAction(ticket({ status: 'in_progress' }), undefined).text).toBe('В работе');
    expect(queueAction(ticket({ status: 'resolved' }), undefined).text).toBe('Ждёт подтверждения заявителя');
    expect(queueAction(ticket({ status: 'closed' }), undefined).tone).toBe('muted');
  });

  it('заголовок и место собираются из полей', () => {
    const fields = [
      ticketField('symptoms', { value: 'не печатает принтер' }),
      ticketField('building', { value: 'Б' }),
      ticketField('cabinet', { value: '312' }),
    ];
    expect(ticketTitleFromFields(fields)).toBe('Не печатает принтер');
    expect(formatLocation({ building: 'Б', cabinet: '312' }, () => 'Корпус Б')).toBe('Корпус Б · кабинет 312');
    expect(formatLocation(undefined)).toBe('место уточняется');
  });
});

describe('след разбора и ответ', () => {
  const analysis = {
    fields: {
      cabinet: {
        trace: [
          { kind: 'found', at: '2026-11-14T10:00:00.000Z', quote: 'в 312 кабинете' },
          { kind: 'matched_cmdb', at: '2026-11-14T10:01:00.000Z' },
        ],
      },
      urgency: {
        trace: [
          { kind: 'asked', at: '2026-11-14T10:02:00.000Z', note: 'Насколько срочно?' },
          { kind: 'answered', at: '2026-11-14T10:03:00.000Z', quote: 'Работа стоит' },
        ],
      },
      department: {
        trace: [
          { kind: 'no_answer', at: '2026-11-14T10:04:00.000Z', note: 'Подразделение' },
          { kind: 'corrected', at: '2026-11-14T10:05:00.000Z', note: 'Отдел кадров' },
          { kind: 'unknown_kind', at: '2026-11-14T10:06:00.000Z' },
        ],
      },
    },
  };

  it('строит шаги в порядке «Нашёл → Сверил → Спросил → Вам»', () => {
    const steps = traceSteps(analysis, []);
    expect(steps.map((step) => step.stage)).toEqual(['found', 'checked', 'asked', 'asked', 'you', 'you']);
    expect(steps[0]?.text).toBe('Нашёл: «в 312 кабинете»');
    expect(steps[1]?.text).toBe('Сверил с базой оборудования');
    expect(steps[4]?.text).toBe('Ответа нет — вопрос диспетчеру');
  });

  it('без analysis собирает след из полей и не дублирует', () => {
    const steps = traceSteps(null, [
      ticketField('cabinet', { quote: { sourceId: 's', text: '312 кабинет' }, needsReview: true }),
      ticketField('equipment', { origin: 'cmdb' }),
      ticketField('urgency', { origin: 'asked' }),
    ]);
    expect(steps.map((step) => step.stage)).toEqual(['found', 'checked', 'asked', 'you']);
    expect(steps[0]?.text).toBe('Нашёл: «312 кабинет»');
  });

  it('авария из анализа читается терпимо', () => {
    expect(
      analysisEmergency({ emergency: { level: 'confirmed', confidence: 1.4, signs: [{ quote: 'идёт дым' }] } }),
    ).toEqual({ level: 'confirmed', confidence: 1, signs: ['идёт дым'] });
    expect(analysisEmergency({ emergency: { level: 'none' } })).toBeNull();
    expect(analysisEmergency(null)).toBeNull();
  });

  it('черновик ответа — шаблон из полей заявки', () => {
    expect(replyTemplate({ number: 'З-1' }, 'Петров С. В.', 'сегодня до 14:30')).toBe(
      'Заявка № З-1 принята. Петров С. В. придёт сегодня до 14:30. Если проблема повторится, ответьте в этом чате.',
    );
    expect(replyTemplate({ number: 'З-2' }, null, null)).toContain('Инженер свяжется с вами');
  });

  it('подписи справочников и варианты для правки', () => {
    const meta = {
      fields: [
        {
          key: 'department',
          label: 'Подразделение',
          group: 'classification' as const,
          type: 'dictionary' as const,
          dictionary: 'department',
          required: true,
          extractHint: '',
          evalMode: 'none' as const,
        },
      ],
      dictionaries: [{ dictionary: 'department', code: 'hr', label: 'Отдел кадров' }],
    };
    expect(fieldDisplayValue(meta, 'department', 'hr')).toBe('Отдел кадров');
    expect(fieldDisplayValue(meta, 'department', 'unknown')).toBe('unknown');
    expect(fieldDisplayValue(meta, 'department', null)).toBeNull();
  });
});

describe('видимые поля и многословие следа', () => {
  it('пустые поля без пометки не показываются, спорные остаются', () => {
    const groups = [
      {
        group: 'location' as const,
        label: 'Место',
        fields: [
          { key: 'cabinet', label: 'Кабинет', group: 'location' as const, field: ticketField('cabinet'), value: '312', order: 0 },
          {
            key: 'floor',
            label: 'Этаж',
            group: 'location' as const,
            field: ticketField('floor', { value: null }),
            value: null,
            order: 1,
          },
          {
            key: 'building',
            label: 'Корпус',
            group: 'location' as const,
            field: ticketField('building', { value: null, needsReview: true }),
            value: null,
            order: 2,
          },
        ],
      },
    ];
    const visible = visibleReviewGroups(groups);
    expect(visible[0]?.fields.map((entry) => entry.key)).toEqual(['cabinet', 'building']);
    expect(filledFieldCount(groups)).toBe(2);
  });

  it('след не раздувается: не больше двух строк на этап', () => {
    const many = {
      fields: {
        a: { trace: [{ kind: 'found', quote: 'раз' }, { kind: 'found', quote: 'два' }, { kind: 'found', quote: 'три' }] },
      },
    };
    expect(traceSteps(many, []).filter((step) => step.stage === 'found')).toHaveLength(2);
  });

  it('место берётся из locationId, если полей нет', () => {
    expect(locationFromTicket({ locationId: 'cab-b-312' }, [])).toEqual({ building: 'Б', cabinet: '312' });
    expect(locationFromTicket({ locationId: null }, [])).toEqual({ building: null, cabinet: null });
  });
});

describe('кандидаты', () => {
  it('процент считается от лучшего балла и не даёт ложных 100 %', () => {
    expect(candidatePercent(189, 189)).toBe(99);
    expect(candidatePercent(98, 189)).toBe(52);
    expect(candidatePercent(69, 189)).toBe(37);
    expect(candidatePercent(0, 100)).toBe(1);
  });

  it('мусор и нулевой лучший балл — ноль', () => {
    expect(candidatePercent(Number.NaN, 100)).toBe(0);
    expect(candidatePercent(10, 0)).toBe(0);
    expect(candidatePercent(10, Number.NaN)).toBe(0);
  });
});
