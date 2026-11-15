import { describe, expect, it } from 'vitest';
import type { MetaResponse, Ticket, TicketField } from '@ugra/contracts';
import {
  appendOutcome,
  articleHelp,
  asTicketStatus,
  capitalizeFirst,
  deadlineInputToIso,
  defaultDeadlineInput,
  dueBadgeLabel,
  dueState,
  equipmentLine,
  equipmentName,
  fieldValue,
  formatRemaining,
  groupSimilarTickets,
  knowledgeQueries,
  knowledgeQuery,
  matchScore,
  myTasks,
  nearestDue,
  nearestDueAt,
  normalizeWords,
  pickArticle,
  quickOutcomes,
  reasonReady,
  recurringEquipmentCount,
  shortDueLabel,
  similarSummary,
  solvedSimilar,
  sortMyTasks,
  statusActions,
  stepCounterLabel,
  stepKey,
  stepProgress,
  stepStates,
  stepsToChecked,
  taskEquipment,
  taskPlace,
  taskTitle,
  tasksCountLabel,
} from '../web/format';
import type { ArticleStep, KnowledgeArticle, SimilarTicket } from '../web/format';

const NOW = Date.parse('2026-11-14T10:00:00.000Z');

function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 't-1',
    number: '2026-0412',
    appealId: 'a-1',
    status: 'assigned',
    priority: 'medium',
    category: 'printer',
    departmentId: 'dep-it',
    assigneeId: 'u-engineer',
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

function meta(): MetaResponse {
  return {
    modules: [],
    fields: [],
    dictionaries: [
      { dictionary: 'building', code: 'Б', label: 'Корпус Б' },
      { dictionary: 'category', code: 'printer', label: 'Принтер и печать' },
    ],
    aiMode: 'stub',
    roles: ['engineer'],
    priorities: ['low', 'medium', 'high', 'critical', 'emergency'],
  };
}

function article(overrides: Partial<KnowledgeArticle> = {}): KnowledgeArticle {
  return {
    id: 'kb-print-red-indicator',
    title: 'Принтер HP не печатает, мигает красный индикатор',
    symptoms: ['мигает красный индикатор', 'принтер не печатает'],
    steps: ['Проверить бумагу в лотке', 'Перезапустить принтер'],
    solution: 'Заменить картридж',
    category: 'printer',
    ...overrides,
  };
}

function similar(overrides: Partial<SimilarTicket> = {}): SimilarTicket {
  return {
    ticketId: 't-9',
    number: '2026-0287',
    status: 'closed',
    title: 'Принтер HP LaserJet M428 не печатает',
    score: 2,
    ...overrides,
  };
}

describe('мои задачи', () => {
  it('оставляет только назначенные мне и незавершённые', () => {
    const tickets = [
      ticket({ id: 'a', status: 'assigned' }),
      ticket({ id: 'b', status: 'in_progress' }),
      ticket({ id: 'c', status: 'assigned', assigneeId: 'u-other' }),
      ticket({ id: 'd', status: 'resolved' }),
      ticket({ id: 'e', status: 'closed' }),
      ticket({ id: 'f', status: 'in_review', assigneeId: null }),
    ];
    expect(myTasks(tickets, 'u-engineer').map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('пустой список даёт пустой результат', () => {
    expect(myTasks([], 'u-engineer')).toEqual([]);
  });

  it('сортирует по сроку, затем по приоритету, задачи без срока — в конце', () => {
    const late = ticket({ id: 'late', number: '3', slaDueAt: '2026-11-14T15:00:00.000Z', priority: 'low' });
    const soonHigh = ticket({ id: 'soon-high', number: '2', slaDueAt: '2026-11-14T11:00:00.000Z', priority: 'high' });
    const noDue = ticket({ id: 'no-due', number: '4', slaDueAt: null, reactDueAt: null, priority: 'critical' });
    const soonLow = ticket({ id: 'soon-low', number: '1', slaDueAt: '2026-11-14T11:00:00.000Z', priority: 'low' });
    const sorted = sortMyTasks([late, noDue, soonLow, soonHigh]).map((item) => item.id);
    expect(sorted).toEqual(['soon-high', 'soon-low', 'late', 'no-due']);
  });

  it('исходный массив не меняется', () => {
    const tickets = [ticket({ id: 'late', slaDueAt: '2026-11-14T15:00:00.000Z' }), ticket({ id: 'soon', slaDueAt: '2026-11-14T11:00:00.000Z' })];
    sortMyTasks(tickets);
    expect(tickets.map((item) => item.id)).toEqual(['late', 'soon']);
  });

  it('ближайший срок выбирает минимум из реакции и решения', () => {
    expect(
      nearestDue({
        reactDueAt: '2026-11-14T11:00:00.000Z',
        slaDueAt: '2026-11-14T15:00:00.000Z',
      }),
    ).toBe(Date.parse('2026-11-14T11:00:00.000Z'));
    expect(nearestDue({ reactDueAt: null, slaDueAt: null })).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('статусные действия', () => {
  it('назначенная: взять в работу и вернуть', () => {
    expect(statusActions('assigned')).toEqual(['take', 'return']);
  });

  it('в работе: выполнить, продлить, вернуть', () => {
    expect(statusActions('in_progress')).toEqual(['resolve', 'extend', 'return']);
  });

  it('завершённые и чужие статусы карточка только читает', () => {
    expect(statusActions('resolved')).toEqual([]);
    expect(statusActions('closed')).toEqual([]);
    expect(statusActions('in_review')).toEqual([]);
  });

  it('неизвестный статус похожей заявки не ломает подписи', () => {
    expect(asTicketStatus('closed')).toBe('closed');
    expect(asTicketStatus('archived')).toBeNull();
  });
});

describe('сроки', () => {
  it('осталось: часы и минуты, меньше 15 минут — внимание', () => {
    const state = dueState('2026-11-14T13:26:00.000Z', NOW);
    expect(state?.text).toBe('осталось 3 ч 26 мин');
    expect(state?.tone).toBe('neutral');
    expect(state?.overdue).toBe(false);

    const soon = dueState('2026-11-14T10:10:00.000Z', NOW);
    expect(soon?.tone).toBe('warn');
    expect(soon?.text).toBe('осталось 10 мин');
  });

  it('просроченный срок считает в минус и красит красным', () => {
    const state = dueState('2026-11-14T09:48:00.000Z', NOW);
    expect(state).toMatchObject({ tone: 'danger', overdue: true, text: 'просрочено 12 мин' });
  });

  it('нет даты или дата битая — срока нет', () => {
    expect(dueState(null, NOW)).toBeNull();
    expect(dueState('', NOW)).toBeNull();
    expect(dueState('не дата', NOW)).toBeNull();
  });

  it('formatRemaining: минуты, часы, дни и мусор', () => {
    expect(formatRemaining(30_000)).toBe('< 1 мин');
    expect(formatRemaining(60 * 60_000)).toBe('1 ч');
    expect(formatRemaining((60 + 5) * 60_000)).toBe('1 ч 5 мин');
    expect(formatRemaining((24 + 2) * 60 * 60_000)).toBe('1 д 2 ч');
    expect(formatRemaining(Number.NaN)).toBe('—');
  });
});

describe('поля заявки', () => {
  it('fieldValue возвращает строку или null для пустого', () => {
    const fields = [field('symptoms', 'Не печатает принтер'), field('cabinet', null), field('floor', '  ')];
    expect(fieldValue(fields, 'symptoms')).toBe('Не печатает принтер');
    expect(fieldValue(fields, 'cabinet')).toBeNull();
    expect(fieldValue(fields, 'floor')).toBeNull();
    expect(fieldValue(fields, 'unknown')).toBeNull();
    expect(fieldValue(null, 'symptoms')).toBeNull();
  });

  it('taskEquipment собирает оборудование и место', () => {
    const fields = [
      field('object', 'принтер'),
      field('equipment', 'HP LaserJet'),
      field('model', 'M428'),
      field('errorCode', 'E-05'),
      field('symptoms', 'не печатает'),
      field('building', 'Б'),
      field('cabinet', '312'),
    ];
    expect(taskEquipment(fields)).toEqual({
      object: 'принтер',
      equipment: 'HP LaserJet',
      model: 'M428',
      errorCode: 'E-05',
      symptoms: 'не печатает',
      building: 'Б',
      cabinet: '312',
    });
  });

  it('модель, записанная дважды, показывается один раз', () => {
    const fields = [field('equipment', 'HP LaserJet Pro M404dn'), field('model', 'HP LaserJet Pro M404dn')];

    expect(equipmentName(fields)).toBe('HP LaserJet Pro M404dn');
    expect(equipmentLine(fields)).toBe('HP LaserJet Pro M404dn');
  });

  it('оборудование одной строкой без пустых частей', () => {
    expect(equipmentLine([field('equipment', 'HP LaserJet'), field('model', 'M428'), field('inventoryNo', 'INV-00417')])).toBe(
      'HP LaserJet M428 · инв. INV-00417',
    );
    expect(equipmentLine([])).toBe('');
  });

  it('название задачи: симптомы, затем объект, затем категория', () => {
    expect(taskTitle(meta(), ticket(), [field('symptoms', 'Не печатает принтер')])).toBe('Не печатает принтер');
    expect(taskTitle(meta(), ticket(), [field('object', 'принтер')])).toBe('Не работает: принтер');
    expect(taskTitle(meta(), ticket(), [])).toBe('Принтер и печать');
    expect(taskTitle(meta(), ticket({ category: null }), [])).toBe('Обращение');
  });

  it('место: подпись справочника, пустые части не рисуются', () => {
    expect(taskPlace(meta(), [field('building', 'Б'), field('cabinet', '312')])).toBe('Корпус Б, каб. 312');
    expect(taskPlace(meta(), [field('cabinet', '312')])).toBe('каб. 312');
    expect(taskPlace(meta(), [])).toBe('');
    expect(taskPlace(null, [field('building', 'Б')])).toBe('Корп. Б');
  });

  it('запрос в базу знаний склеивает симптомы, оборудование и код ошибки', () => {
    const query = knowledgeQuery(
      [
        field('symptoms', 'не печатает'),
        field('object', 'принтер'),
        field('equipment', 'HP LaserJet'),
        field('model', 'M428'),
        field('errorCode', 'E-05'),
      ],
      'printer',
    );
    expect(query).toBe('не печатает принтер HP LaserJet M428 E-05 printer');
    expect(knowledgeQuery([])).toBe('');
    expect(knowledgeQuery([field('symptoms', '   ')])).toBe('');
  });
});

describe('статья базы знаний', () => {
  it('normalizeWords отбрасывает короткие и служебные слова', () => {
    expect(normalizeWords('Принтер не печатает, это ошибка')).toEqual(['принтер', 'печатает', 'ошибка']);
  });

  it('matchScore считает слова по началу', () => {
    expect(matchScore(['замятие', 'принтер'], 'Замятие бумаги в принтере')).toBe(2);
    expect(matchScore([], 'принтер')).toBe(0);
  });

  it('pickArticle выбирает статью с лучшим совпадением', () => {
    const red = article();
    const jam = article({
      id: 'kb-print-jam',
      title: 'Замятие бумаги в принтере',
      symptoms: ['замятие бумаги', 'лист застрял внутри'],
      steps: ['Открыть крышку'],
      solution: 'Вытянуть лист',
    });
    expect(pickArticle([jam, red], 'мигает красный индикатор на принтере')?.id).toBe('kb-print-red-indicator');
    expect(pickArticle([jam, red], 'замятие бумаги застрял лист')?.id).toBe('kb-print-jam');
  });

  it('пустая выдача — null, нулевое совпадение — первая статья', () => {
    expect(pickArticle([], 'принтер')).toBeNull();
    expect(pickArticle([article({ id: 'first' })], 'сломалась кофеварка')?.id).toBe('first');
  });
});

describe('частая поломка оборудования', () => {
  it('считает заявки по той же модели, а не по слову «принтер»', () => {
    const tickets = [
      similar(),
      similar({ ticketId: 't-10', title: 'HP LaserJet M428 замятие бумаги' }),
      similar({ ticketId: 't-11', title: 'Kyocera ECOSYS не печатает' }),
    ];
    expect(recurringEquipmentCount(tickets, 'HP LaserJet M428')).toBe(2);
    expect(recurringEquipmentCount(tickets, 'Kyocera ECOSYS')).toBe(1);
  });

  it('общие слова без модели не дают предупреждения', () => {
    expect(recurringEquipmentCount([similar(), similar()], 'принтер')).toBe(0);
    expect(recurringEquipmentCount([similar(), similar()], '')).toBe(0);
  });

  it('пустая выдача — ноль', () => {
    expect(recurringEquipmentCount([], 'HP LaserJet M428')).toBe(0);
  });
});

describe('результат работы', () => {
  it('быстрые формулировки по категории; неизвестная категория — пусто', () => {
    expect(quickOutcomes('printer')).toContain('Заменён картридж');
    expect(quickOutcomes('printer')).toHaveLength(3);
    expect(quickOutcomes(null)).toEqual([]);
    expect(quickOutcomes('coffee')).toEqual([]);
  });

  it('appendOutcome ставит точку и не дублирует формулировку', () => {
    expect(appendOutcome('', 'Заменён картридж')).toBe('Заменён картридж');
    expect(appendOutcome('Удалён лист', 'Заменён картридж')).toBe('Удалён лист. Заменён картридж');
    expect(appendOutcome('Удалён лист.', 'Заменён картридж')).toBe('Удалён лист. Заменён картридж');
    expect(appendOutcome('Заменён картридж', 'Заменён картридж')).toBe('Заменён картридж');
    expect(appendOutcome('Текст', '  ')).toBe('Текст');
  });

  it('прогресс чек-листа считает отмеченные шаги', () => {
    expect(stepProgress(['a', 'b', 'c'], new Set([0, 2]))).toEqual({ done: 2, total: 3 });
    expect(stepProgress([], new Set())).toEqual({ done: 0, total: 0 });
  });

  it('отметки с сервера раскладываются в карту чек-листа', () => {
    const steps: ArticleStep[] = [
      {
        ticketId: 't-1',
        articleId: 'kb-print-jam',
        stepIndex: 0,
        done: true,
        updatedAt: '2026-11-14T10:00:00.000Z',
      },
      {
        ticketId: 't-1',
        articleId: 'kb-print-jam',
        stepIndex: 1,
        done: false,
        updatedAt: '2026-11-14T10:00:00.000Z',
      },
      {
        ticketId: 't-1',
        articleId: 'kb-print-red-indicator',
        stepIndex: 2,
        done: true,
        updatedAt: '2026-11-14T10:00:00.000Z',
      },
    ];
    const checked = stepsToChecked(steps);
    expect(checked[stepKey('kb-print-jam', 0)]).toBe(true);
    expect(checked[stepKey('kb-print-jam', 1)]).toBeUndefined();
    expect(checked[stepKey('kb-print-red-indicator', 2)]).toBe(true);
    expect(stepsToChecked([])).toEqual({});
  });

  it('счётчик чек-листа: «выполнено N из M»', () => {
    expect(stepCounterLabel(2, 5)).toBe('выполнено 2 из 5');
    expect(stepCounterLabel(0, 0)).toBe('выполнено 0 из 0');
    expect(stepKey('kb-print-jam', 3)).toBe('kb-print-jam:3');
  });

  it('подпись списка склоняет «задача» по числу', () => {
    expect(tasksCountLabel(1)).toBe('1 задача');
    expect(tasksCountLabel(3)).toBe('3 задачи');
    expect(tasksCountLabel(5)).toBe('5 задач');
    expect(tasksCountLabel(11)).toBe('11 задач');
    expect(tasksCountLabel(21)).toBe('21 задача');
    expect(tasksCountLabel(0)).toBe('0 задач');
  });
});

describe('диалоги', () => {
  it('значение по умолчанию для продления — локальное время через два часа', () => {
    expect(defaultDeadlineInput(Date.parse('2026-11-14T10:00:00'), 2)).toBe('2026-11-14T12:00');
  });

  it('datetime-local → ISO; пустое и битое — null', () => {
    expect(deadlineInputToIso('2026-11-14T12:00')).toMatch(/^2026-11-14T\d{2}:00:00\.000Z$/);
    expect(deadlineInputToIso('')).toBeNull();
    expect(deadlineInputToIso('не дата')).toBeNull();
  });

  it('причина обязательна: минимум три символа', () => {
    expect(reasonReady('Нет запчасти')).toBe(true);
    expect(reasonReady('  да ')).toBe(false);
    expect(reasonReady('')).toBe(false);
  });
});

describe('подписи карточки задачи', () => {
  it('заголовок из симптомов начинается с заглавной буквы', () => {
    expect(capitalizeFirst('  не печатает, мигает красный')).toBe('Не печатает, мигает красный');
    expect(capitalizeFirst('')).toBe('');
    expect(capitalizeFirst('   ')).toBe('');
  });

  it('таймер: «до срока», просрочка и отсутствие срока', () => {
    expect(dueBadgeLabel(dueState('2026-11-14T12:14:00.000Z', NOW))).toBe('2 ч 14 мин до срока');
    expect(dueBadgeLabel(dueState('2026-11-14T09:48:00.000Z', NOW))).toBe('просрочено 12 мин');
    expect(dueBadgeLabel(null)).toBe('срок не задан');
  });

  it('короткая подпись для строки списка', () => {
    expect(shortDueLabel('2026-11-14T12:14:00.000Z', NOW)).toBe('2 ч 14 мин');
    expect(shortDueLabel('2026-11-14T09:48:00.000Z', NOW)).toBe('просрочено');
    expect(shortDueLabel(null, NOW)).toBe('без срока');
    expect(shortDueLabel('битая дата', NOW)).toBe('без срока');
  });

  it('ближайший срок — конкретная дата, а не только число', () => {
    expect(
      nearestDueAt({
        reactDueAt: '2026-11-14T12:00:00.000Z',
        slaDueAt: '2026-11-14T15:00:00.000Z',
      }),
    ).toBe('2026-11-14T12:00:00.000Z');
    expect(nearestDueAt({ reactDueAt: null, slaDueAt: null })).toBeNull();
  });
});

describe('запросы в базу знаний', () => {
  const fields = [
    field('symptoms', 'не печатает, горит оранжевая лампочка'),
    field('object', 'принтер HP'),
    field('equipment', 'HP LaserJet Pro M404dn'),
    field('model', 'HP LaserJet Pro M404dn'),
  ];

  it('первый кандидат — полный запрос, дальше всё более общие', () => {
    const queries = knowledgeQueries(fields, 'printer');

    expect(queries[0]).toBe(knowledgeQuery(fields, 'printer'));
    expect(queries).toContain('принтер HP');
    expect(queries).toContain('HP LaserJet');
    expect(queries).toContain('не печатает, горит оранжевая лампочка');
    expect(queries.at(-1)).toBe('печатает горит');
  });

  it('пустые и повторяющиеся кандидаты не попадают', () => {
    const queries = knowledgeQueries([field('symptoms', 'не печатает')]);

    expect(new Set(queries).size).toBe(queries.length);
    expect(queries.every((query) => query.trim() !== '')).toBe(true);
  });

  it('без полей запросов нет', () => {
    expect(knowledgeQueries([])).toEqual([]);
    expect(knowledgeQueries(null)).toEqual([]);
  });
});

describe('похожие решённые заявки', () => {
  it('отменённые не считаются решением', () => {
    const list = solvedSimilar([
      similar({ ticketId: 't-1', status: 'closed' }),
      similar({ ticketId: 't-2', status: 'cancelled' }),
      similar({ ticketId: 't-3', status: 'resolved' }),
    ]);

    expect(list.map((ticket) => ticket.ticketId)).toEqual(['t-1', 't-3']);
  });

  it('одинаковые формулировки собираются в одну строку', () => {
    const groups = groupSimilarTickets([
      similar({ ticketId: 't-1', number: '2026-1', title: 'принтер не печатает' }),
      similar({ ticketId: 't-2', number: '2026-5', title: 'принтер не печатает' }),
      similar({ ticketId: 't-3', number: '2026-3', title: 'нет сети' }),
    ]);

    expect(groups).toEqual([
      { title: 'принтер не печатает', count: 2, number: '2026-5' },
      { title: 'нет сети', count: 1, number: '2026-3' },
    ]);
  });

  it('сводка склоняет заявки и формулировки', () => {
    expect(similarSummary([])).toBe('похожих решений нет');
    expect(similarSummary([{ title: 'одна', count: 1, number: '1' }])).toBe(
      '1 заявка с той же формулировкой',
    );
    expect(
      similarSummary([
        { title: 'первая', count: 3, number: '1' },
        { title: 'вторая', count: 1, number: '2' },
      ]),
    ).toBe('4 заявки · 2 формулировки');
  });

  it('пустые заголовки пропускаются', () => {
    expect(groupSimilarTickets([similar({ title: '   ' })])).toEqual([]);
  });
});

describe('шаги диагностики', () => {
  const steps = ['Первый', 'Второй', 'Третий'];

  it('первый неотмеченный шаг — текущий', () => {
    expect(stepStates(steps, { 'kb-1:0': true }, 'kb-1')).toEqual(['done', 'now', 'next']);
  });

  it('все отмечены — текущего шага нет', () => {
    expect(stepStates(['Первый'], { 'kb-1:0': true }, 'kb-1')).toEqual(['done']);
  });

  it('ничего не отмечено — текущий первый', () => {
    expect(stepStates(steps, {}, 'kb-1')).toEqual(['now', 'next', 'next']);
  });

  it('отметки другой статьи не влияют', () => {
    expect(stepStates(['Первый'], { 'kb-2:0': true }, 'kb-1')).toEqual(['now']);
  });
});

describe('статистика статьи', () => {
  it('без статистики блока нет', () => {
    expect(articleHelp(article())).toBeNull();
    expect(articleHelp(null)).toBeNull();
  });

  it('помогла N из M с долей для кольца', () => {
    const help = articleHelp(article({ stats: { helped: 9, total: 11 } }));

    expect(help).toEqual({ helped: 9, total: 11, ratio: 9 / 11, label: 'помогла 9 из 11 раз' });
  });

  it('одна помощь склоняется правильно', () => {
    expect(articleHelp(article({ stats: { helped: 1, total: 1 } }))?.label).toBe('помогла 1 из 1 раз');
  });

  it('битые числа не рисуются', () => {
    expect(articleHelp(article({ stats: { helped: 12, total: 11 } }))).toBeNull();
    expect(articleHelp(article({ stats: { helped: 0, total: 0 } }))).toBeNull();
  });
});
