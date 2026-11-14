import { describe, expect, it } from 'vitest';
import type { DictionaryItem, EngineerInfo, Ticket } from '@ugra/contracts';
import {
  ALL_DEPARTMENTS,
  DEFAULT_ENGINEER_FILTERS,
  departmentLabel,
  filterEngineers,
  gradeLabel,
  initials,
  loadState,
  skillChips,
  sortEngineers,
  taskDeadline,
} from '../web/format';

const DICTIONARIES: DictionaryItem[] = [
  { dictionary: 'department', code: 'dep-service', label: 'Служба поддержки (1-я линия)' },
  { dictionary: 'department', code: 'dep-it', label: 'Рабочие места и периферия' },
  { dictionary: 'department', code: 'dep-network', label: 'Сети и связь' },
  { dictionary: 'building', code: 'А', label: 'Корпус А' },
];

function engineer(overrides: Partial<EngineerInfo> = {}): EngineerInfo {
  return {
    id: 'u-1',
    fullName: 'Игорь Лебедев',
    departmentId: 'dep-service',
    position: 'Инженер 1-й линии',
    level: 'first_line',
    skills: [{ skill: 'printer', level: 3 }],
    buildings: ['А', 'Б'],
    onShift: false,
    openTickets: 2,
    resolvedSimilar: 12,
    ...overrides,
  };
}

describe('departmentLabel', () => {
  it('берёт подпись из справочника department', () => {
    expect(departmentLabel(DICTIONARIES, 'dep-it')).toBe('Рабочие места и периферия');
  });

  it('неизвестный код оставляет как есть', () => {
    expect(departmentLabel(DICTIONARIES, 'dep-unknown')).toBe('dep-unknown');
  });

  it('пустое подразделение — понятная подпись', () => {
    expect(departmentLabel(DICTIONARIES, null)).toBe('Подразделение не указано');
    expect(departmentLabel(DICTIONARIES, '')).toBe('Подразделение не указано');
  });
});

describe('gradeLabel', () => {
  it('грейды кейса — человеческие подписи', () => {
    expect(gradeLabel('first_line')).toBe('Первая линия');
    expect(gradeLabel('second_line')).toBe('Вторая линия');
    expect(gradeLabel('lead')).toBe('Ведущий специалист');
  });

  it('неизвестный грейд не теряется', () => {
    expect(gradeLabel('third_line')).toBe('third_line');
    expect(gradeLabel(2)).toBe('2-й уровень');
  });

  it('пустой грейд — подпись, а не пустота', () => {
    expect(gradeLabel(undefined)).toBe('Грейд не указан');
    expect(gradeLabel('   ')).toBe('Грейд не указан');
    expect(gradeLabel(Number.NaN)).toBe('Грейд не указан');
  });
});

describe('initials', () => {
  it('две первые буквы имени и фамилии', () => {
    expect(initials('Игорь Лебедев')).toBe('ИЛ');
    expect(initials('марина соловьёва')).toBe('МС');
  });

  it('одно слово и пустая строка', () => {
    expect(initials('Петров')).toBe('П');
    expect(initials('   ')).toBe('?');
  });
});

describe('loadState', () => {
  it('свободный исполнитель — зелёная шкала', () => {
    expect(loadState(0)).toMatchObject({
      count: 0,
      filled: 0,
      percent: 0,
      tone: 'ok',
      overloaded: false,
      text: '0 из 5 задач',
      hint: 'свободен',
    });
    expect(loadState(2)).toMatchObject({ filled: 2, percent: 40, tone: 'ok', hint: 'есть запас' });
  });

  it('почти предел — жёлтый, без перегруза', () => {
    expect(loadState(4)).toMatchObject({
      filled: 4,
      percent: 80,
      tone: 'warn',
      overloaded: false,
      hint: 'почти предел',
    });
  });

  it('порог 5 — перегруз', () => {
    expect(loadState(5)).toMatchObject({
      count: 5,
      filled: 5,
      percent: 100,
      tone: 'danger',
      overloaded: true,
      text: '5 из 5 задач',
      hint: 'перегруз',
    });
    expect(loadState(7)).toMatchObject({ count: 7, filled: 5, percent: 100, overloaded: true });
  });

  it('свой порог и мусор на входе', () => {
    expect(loadState(3, 3)).toMatchObject({ filled: 3, percent: 100, overloaded: true });
    expect(loadState(1, 0)).toMatchObject({ threshold: 1, filled: 1, percent: 100 });
    expect(loadState(Number.NaN)).toMatchObject({ count: 0, filled: 0, overloaded: false });
    expect(loadState(-4)).toMatchObject({ count: 0, filled: 0 });
  });
});

const ENGINEERS: EngineerInfo[] = [
  engineer({
    id: 'u-1',
    fullName: 'Игорь Лебедев',
    departmentId: 'dep-service',
    skills: [{ skill: 'printer', level: 3 }],
    buildings: ['А'],
    onShift: false,
    openTickets: 2,
  }),
  engineer({
    id: 'u-2',
    fullName: 'Артём Кузнецов',
    departmentId: 'dep-it',
    skills: [{ skill: 'network', level: 5 }],
    buildings: ['ПРОМ'],
    onShift: true,
    openTickets: 1,
  }),
  engineer({
    id: 'u-3',
    fullName: 'Марина Соловьёва',
    departmentId: 'dep-network',
    skills: [{ skill: '1c', level: 4 }],
    buildings: ['В'],
    onShift: false,
    openTickets: 0,
  }),
];

const departmentOf = (departmentId: string | null): string => departmentLabel(DICTIONARIES, departmentId);

/** Фильтры «показать всех»: по умолчанию экран показывает только тех, кто на смене. */
const ALL_FILTERS = { ...DEFAULT_ENGINEER_FILTERS, onlyOnShift: false };

describe('filterEngineers', () => {
  it('по умолчанию — только на смене, без фильтров — все', () => {
    expect(DEFAULT_ENGINEER_FILTERS.onlyOnShift).toBe(true);
    expect(filterEngineers(ENGINEERS, DEFAULT_ENGINEER_FILTERS).map((item) => item.id)).toEqual(['u-2']);
    expect(filterEngineers(ENGINEERS, ALL_FILTERS)).toHaveLength(3);
  });

  it('фильтр по подразделению', () => {
    const result = filterEngineers(ENGINEERS, {
      ...ALL_FILTERS,
      department: 'dep-it',
    });
    expect(result.map((item) => item.id)).toEqual(['u-2']);
  });

  it('только на смене', () => {
    const result = filterEngineers(ENGINEERS, {
      ...ALL_FILTERS,
      onlyOnShift: true,
    });
    expect(result.map((item) => item.id)).toEqual(['u-2']);
  });

  it('поиск по имени, навыку, подразделению и корпусу', () => {
    const find = (query: string): string[] =>
      filterEngineers(ENGINEERS, { ...ALL_FILTERS, query }, { departmentLabel: departmentOf }).map(
        (item) => item.id,
      );
    expect(find('игорь')).toEqual(['u-1']);
    expect(find('принтер')).toEqual(['u-1']);
    expect(find('связь')).toEqual(['u-3']);
    expect(find('пром')).toEqual(['u-2']);
  });

  it('пустая выдача, когда никто не подошёл', () => {
    expect(filterEngineers(ENGINEERS, { ...ALL_FILTERS, query: 'нет такого' })).toEqual([]);
    expect(filterEngineers([], { ...ALL_FILTERS, department: ALL_DEPARTMENTS })).toEqual([]);
  });
});

describe('sortEngineers', () => {
  it('перегруз и смена сверху, дальше по числу открытых заявок', () => {
    const list = [
      engineer({ id: 'idle', fullName: 'Анна', openTickets: 0, onShift: false }),
      engineer({ id: 'on-shift', fullName: 'Борис', openTickets: 2, onShift: true }),
      engineer({ id: 'overload-off', fullName: 'Виктор', openTickets: 6, onShift: false }),
      engineer({ id: 'overload-on', fullName: 'Глеб', openTickets: 5, onShift: true }),
    ];
    expect(sortEngineers(list).map((item) => item.id)).toEqual([
      'overload-on',
      'overload-off',
      'on-shift',
      'idle',
    ]);
  });

  it('свой порог перегруза', () => {
    const list = [
      engineer({ id: 'two', fullName: 'Анна', openTickets: 2 }),
      engineer({ id: 'three', fullName: 'Борис', openTickets: 3 }),
    ];
    expect(sortEngineers(list, 3).map((item) => item.id)).toEqual(['three', 'two']);
  });

  it('исходный массив не меняется', () => {
    const list = [engineer({ id: 'low', openTickets: 0 }), engineer({ id: 'high', openTickets: 5 })];
    sortEngineers(list);
    expect(list.map((item) => item.id)).toEqual(['low', 'high']);
  });
});

describe('skillChips', () => {
  it('подписи и уровень, сначала сильные навыки', () => {
    expect(
      skillChips([
        { skill: 'printer', level: 3 },
        { skill: 'network', level: 5 },
      ]),
    ).toEqual([
      { code: 'network', label: 'Сети', level: 5 },
      { code: 'printer', label: 'Принтеры', level: 3 },
    ]);
  });

  it('уровень подрезается к 1…5, неизвестный код остаётся', () => {
    expect(skillChips([{ skill: 'quantum', level: 9 }])).toEqual([
      { code: 'quantum', label: 'quantum', level: 5 },
    ]);
    expect(skillChips([{ skill: 'printer', level: 0 }])[0]?.level).toBe(1);
  });

  it('дубли схлопываются по большему уровню', () => {
    expect(
      skillChips([
        { skill: 'pc', level: 2 },
        { skill: 'pc', level: 4 },
      ]),
    ).toEqual([{ code: 'pc', label: 'ПК', level: 4 }]);
  });

  it('пустой список навыков', () => {
    expect(skillChips([])).toEqual([]);
  });
});

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

const NOW = Date.parse('2026-11-14T10:00:00.000Z');

describe('taskDeadline', () => {
  it('берёт ближайший срок и красит близкий жёлтым', () => {
    const due = taskDeadline(
      ticket({
        reactDueAt: '2026-11-14T10:05:00.000Z',
        slaDueAt: '2026-11-14T12:00:00.000Z',
      }),
      NOW,
    );
    expect(due).toMatchObject({
      at: '2026-11-14T10:05:00.000Z',
      overdue: false,
      tone: 'warn',
    });
  });

  it('далёкий срок — нейтральный', () => {
    const due = taskDeadline(ticket({ slaDueAt: '2026-11-14T15:00:00.000Z' }), NOW);
    expect(due).toMatchObject({ tone: 'neutral', overdue: false });
  });

  it('просроченный срок — красный', () => {
    const due = taskDeadline(ticket({ slaDueAt: '2026-11-14T09:00:00.000Z' }), NOW);
    expect(due).toMatchObject({ tone: 'danger', overdue: true });
  });

  it('нет сроков или даты битые — null', () => {
    expect(taskDeadline(ticket(), NOW)).toBeNull();
    expect(taskDeadline(ticket({ reactDueAt: 'не дата' }), NOW)).toBeNull();
  });
});
