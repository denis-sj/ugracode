import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Ticket } from '@ugra/contracts';
import type { Place } from '../web/format';
import {
  assignmentState,
  clockFromMs,
  eventLabel,
  humanizeEventText,
  incidentTitle,
  isServiceEvent,
  plural,
  previousEmergencies,
  reactionNormMinutes,
  reactionState,
  reactionText,
  ruleLabel,
  ruleLabels,
  sanitizeTimeline,
} from '../web/incident-view';

const MINUTE = 60_000;

function ticket(patch: Partial<Ticket> = {}): Ticket {
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
    reactDueAt: '2026-11-14T10:15:00.000Z',
    slaDueAt: '2026-11-14T11:00:00.000Z',
    equipmentId: null,
    locationId: null,
    confirmedBy: null,
    confirmedAt: null,
    createdAt: '2026-11-14T10:00:00.000Z',
    updatedAt: '2026-11-14T10:00:00.000Z',
    ...patch,
  };
}

function field(fieldKey: string, value: string | number | null): {
  fieldKey: string;
  value: string | number | null;
} {
  return { fieldKey, value };
}

describe('авария: русские подписи вместо кодов', () => {
  it('подписи правил совпадают с data/emergency-rules.json', () => {
    const file = JSON.parse(
      readFileSync(join(process.cwd(), 'data/emergency-rules.json'), 'utf8'),
    ) as { rules: Array<{ id: string; title: string }> };

    expect(file.rules.length).toBeGreaterThan(0);
    for (const rule of file.rules) expect(ruleLabel(rule.id)).toBe(rule.title);
  });

  it('неизвестное правило не показывается кодом', () => {
    expect(ruleLabel('emergency.custom')).toBeNull();
    expect(ruleLabels(['emergency.fire', 'emergency.custom', 'emergency.fire'])).toEqual([
      'Пожар, дым, запах горелого',
    ]);
    expect(ruleLabels([])).toEqual([]);
  });

  it('служебное событие получает русское название', () => {
    expect(eventLabel('analysis.step.completed')).toBe('Шаг разбора выполнен');
    expect(eventLabel('run.failed')).toBe('Разбор не удался');
    expect(eventLabel('ticket.something.new')).toBe('Событие');
  });

  it('описание события теряет коды правил, полей и служебные префиксы', () => {
    expect(
      humanizeEventText('правила: emergency.fire, emergency.electric · building: Б', {
        building: 'Корпус',
      }),
    ).toBe('правила: Пожар, дым, запах горелого, Отказ электроснабжения и искрение · Корпус: Б');

    expect(humanizeEventText('emergency.custom · analysis.step.completed')).toBe(
      'правило регламента · событие разбора',
    );
    expect(humanizeEventText('просто текст')).toBe('просто текст');
    expect(humanizeEventText('agent.intake')).toBe('');
    expect(humanizeEventText('intake.normalize')).toBe('');
    expect(humanizeEventText('deadline')).toBe('');

    expect(
      humanizeEventText(
        'category: printer · urgency: down · building: Б',
        { category: 'Категория', urgency: 'Срочность', building: 'Корпус' },
        { category: { printer: 'Принтер и печать' }, urgency: { down: 'Работа остановлена' } },
      ),
    ).toBe('Категория: Принтер и печать · Срочность: Работа остановлена · Корпус: Б');
  });

  it('хронология не показывает заголовок-код', () => {
    const items = sanitizeTimeline(
      [
        {
          id: 'e-1',
          title: 'analysis.step.completed',
          description: 'правила: emergency.fire',
          at: '14:04',
          tone: 'accent',
        },
        { id: 'e-2', title: 'Признана авария', description: 'agent.intake', tone: 'danger' },
        { id: 'e-3', title: 'Признана авария', tone: 'danger' },
      ],
      {},
    );

    expect(items[0]).toEqual({
      id: 'e-1',
      title: 'Шаг разбора выполнен',
      description: 'правила: Пожар, дым, запах горелого',
      at: '14:04',
      tone: 'accent',
    });
    expect(items[1]).toEqual({
      id: 'e-2',
      title: 'Признана авария',
      description: undefined,
      tone: 'danger',
    });
    expect(items[2]?.title).toBe('Признана авария');
  });

  it('прячет служебные шаги разбора из хронологии', () => {
    expect(isServiceEvent({ type: 'analysis.step.completed' })).toBe(true);
    expect(isServiceEvent({ type: 'agent.step' })).toBe(true);
    expect(isServiceEvent({ type: 'report-kb-gaps.miss' })).toBe(true);
    expect(isServiceEvent({ type: 'ticket.status.changed' })).toBe(false);
    expect(isServiceEvent({ type: 'emergency.detected' })).toBe(false);
    expect(isServiceEvent('мусор')).toBe(false);
    expect(isServiceEvent(null)).toBe(false);
  });
});

describe('авария: человеческий заголовок', () => {
  it('берёт симптомы заявителя и делает первую букву заглавной', () => {
    expect(
      incidentTitle(
        [
          field('symptoms', 'идёт дым, пахнет горелым'),
          field('object', 'розетка'),
          field('building', 'Б'),
        ],
        'Сеть и связь',
      ),
    ).toBe('Идёт дым, пахнет горелым');
  });

  it('без симптомов берёт объект, затем категорию', () => {
    expect(incidentTitle([field('object', 'принтер')], 'Печать')).toBe('Принтер');
    expect(incidentTitle([], 'Печать')).toBe('Печать');
    expect(incidentTitle([field('symptoms', '   ')], null)).toBe('Обращение');
    expect(incidentTitle(null, null)).toBe('Обращение');
  });

  it('сжимает переводы строк и длинный текст', () => {
    expect(incidentTitle([field('symptoms', ' дым\n\n и гарь ')], null)).toBe('Дым и гарь');
    const long = incidentTitle([field('symptoms', 'а'.repeat(120))], null);
    expect(long.endsWith('…')).toBe(true);
    expect(long.length).toBe(90);
  });
});

describe('авария: норма реакции', () => {
  it('считает норму из срока заявки, а не из макета', () => {
    expect(reactionNormMinutes(ticket())).toBe(15);
    expect(
      reactionNormMinutes(
        ticket({ createdAt: '2026-11-14T10:00:00.000Z', reactDueAt: '2026-11-14T12:00:00.000Z' }),
      ),
    ).toBe(120);
  });

  it('без срока и с битыми датами нормы нет', () => {
    expect(reactionNormMinutes(ticket({ reactDueAt: null }))).toBeNull();
    expect(
      reactionNormMinutes(ticket({ createdAt: 'не дата', reactDueAt: '2026-11-14T10:15:00.000Z' })),
    ).toBeNull();
    expect(
      reactionNormMinutes(ticket({ createdAt: '2026-11-14T10:00:00.000Z', reactDueAt: 'мусор' })),
    ).toBeNull();
    expect(
      reactionNormMinutes(ticket({ createdAt: '2026-11-14T10:00:00.000Z', reactDueAt: '2026-11-14T10:00:00.000Z' })),
    ).toBeNull();
  });

  it('показывает превышение и остаток', () => {
    expect(reactionState(15, 16 * MINUTE)).toBe('overdue');
    expect(reactionState(15, 10 * MINUTE)).toBe('left');
    expect(reactionState(null, 10 * MINUTE)).toBe('unknown');

    expect(reactionText(15, 16 * MINUTE)).toBe('норма реакции 15 мин превышена');
    expect(reactionText(15, 10 * MINUTE)).toBe('норма реакции 15 мин · осталось 5 мин');
    expect(reactionText(15, 14 * MINUTE + 30_000)).toBe('норма реакции 15 мин · осталось < 1 мин');
    expect(reactionText(null, 0)).toBe('норма реакции не задана');
  });
});

describe('авария: прошлые аварии в корпусе', () => {
  const places: Record<string, Place> = {
    't-current': { building: 'Б', floor: '3', cabinet: '312' },
    't-b1': { building: 'Корпус Б', floor: '1', cabinet: '101' },
    't-b2': { building: 'б', floor: '2', cabinet: '201' },
    't-a': { building: 'А', floor: '1', cabinet: '105' },
    't-regular': { building: 'Б', floor: '3', cabinet: '313' },
    't-closed': { building: 'Б', floor: '1', cabinet: '102' },
    't-no-place': { building: null, floor: null, cabinet: null },
  };
  const placeOf = (id: string): Place | null => places[id] ?? null;

  const current = ticket({ id: 't-current' });
  const list = [
    current,
    ticket({ id: 't-b1', createdAt: '2026-11-10T10:00:00.000Z' }),
    ticket({ id: 't-b2', createdAt: '2026-11-12T10:00:00.000Z' }),
    ticket({ id: 't-a', createdAt: '2026-11-13T10:00:00.000Z' }),
    ticket({ id: 't-regular', isEmergency: false, createdAt: '2026-11-13T12:00:00.000Z' }),
    ticket({ id: 't-closed', status: 'closed', createdAt: '2026-11-09T10:00:00.000Z' }),
    ticket({ id: 't-no-place', createdAt: '2026-11-13T13:00:00.000Z' }),
  ];

  it('берёт только аварии того же корпуса, свежие сверху', () => {
    const previous = previousEmergencies(list, current, placeOf);
    expect(previous.items.map((item) => item.id)).toEqual(['t-b2', 't-b1', 't-closed']);
    expect(previous.total).toBe(3);
    expect(previous.open).toBe(2);
    expect(previous.lastAt).toBe('2026-11-12T10:00:00.000Z');
  });

  it('без корпуса и без выбранной заявки список пуст', () => {
    expect(previousEmergencies(list, current, placeOf).total).toBe(3);
    expect(previousEmergencies(list, ticket({ id: 't-no-place' }), placeOf)).toEqual({
      items: [],
      total: 0,
      open: 0,
      lastAt: null,
    });
    expect(previousEmergencies(list, null, placeOf).total).toBe(0);
    expect(previousEmergencies(list, current, () => null).total).toBe(0);
  });

  it('оставляет не больше пяти строк', () => {
    const many = [
      current,
      ...Array.from({ length: 8 }, (_, index) =>
        ticket({ id: `t-${index}`, createdAt: `2026-11-0${index + 1}T10:00:00.000Z` }),
      ),
    ];
    const previous = previousEmergencies(many, current, () => ({ building: 'Б', floor: null, cabinet: null }));
    expect(previous.total).toBe(8);
    expect(previous.items).toHaveLength(5);
  });
});

describe('авария: кнопка «Назначить»', () => {
  it('разрешает назначение на проверке и в ожидании ответа', () => {
    expect(assignmentState(ticket(), true)).toEqual({ allowed: true, hint: null });
    expect(assignmentState(ticket({ status: 'waiting_applicant' }), true)).toEqual({
      allowed: true,
      hint: null,
    });
  });

  it('объясняет, почему назначить нельзя', () => {
    expect(assignmentState(ticket(), false)).toEqual({
      allowed: false,
      hint: 'Назначать может диспетчер',
    });
    expect(assignmentState(ticket({ status: 'assigned' }), true)).toEqual({
      allowed: false,
      hint: 'Назначение доступно на проверке заявки',
    });
    expect(assignmentState(ticket({ assigneeId: 'u-1' }), true)).toEqual({
      allowed: false,
      hint: null,
    });
  });
});

describe('авария: мелочи', () => {
  it('склоняет по-русски', () => {
    expect(plural(1, 'событие', 'события', 'событий')).toBe('событие');
    expect(plural(2, 'событие', 'события', 'событий')).toBe('события');
    expect(plural(5, 'событие', 'события', 'событий')).toBe('событий');
    expect(plural(11, 'событие', 'события', 'событий')).toBe('событий');
    expect(plural(21, 'событие', 'события', 'событий')).toBe('событие');
    expect(plural(-3, 'событие', 'события', 'событий')).toBe('события');
  });

  it('показывает время отметки шага', () => {
    const at = new Date('2026-11-14T14:04:00.000Z').getTime();
    expect(clockFromMs(at)).toMatch(/^\d{2}:\d{2}$/);
    expect(clockFromMs(null)).toBeUndefined();
    expect(clockFromMs(Number.NaN)).toBeUndefined();
  });
});
