import type { ReferenceData } from '@ugra/core';
import { EngineerList, EngineersFile, type EngineerProfile } from '../contracts';

/**
 * Встроенный набор на случай, когда `data/engineers.json` ещё не пришёл (задача 008).
 * Пять человек из разных подразделений, чтобы подбор и демо работали без сида.
 */
export const DEMO_ENGINEERS: EngineerProfile[] = [
  {
    id: 'u-eng-1',
    fullName: 'Иванов Пётр',
    departmentId: 'dep-it',
    level: 4,
    skills: [
      { skill: 'принтеры HP', level: 4 },
      { skill: 'оргтехника', level: 3 },
    ],
    buildings: ['Б'],
    onShift: true,
    openTickets: 2,
    resolvedSimilar: 5,
  },
  {
    id: 'u-eng-2',
    fullName: 'Смирнова Анна',
    departmentId: 'dep-network',
    level: 4,
    skills: [
      { skill: 'сети', level: 5 },
      { skill: 'wi-fi', level: 4 },
    ],
    buildings: ['А', 'Б'],
    onShift: true,
    openTickets: 1,
    resolvedSimilar: 7,
  },
  {
    id: 'u-eng-3',
    fullName: 'Кузнецов Игорь',
    departmentId: 'dep-software',
    level: 5,
    skills: [
      { skill: '1С', level: 5 },
      { skill: 'почта', level: 4 },
    ],
    buildings: ['В'],
    onShift: false,
    openTickets: 6,
    resolvedSimilar: 9,
  },
  {
    id: 'u-eng-4',
    fullName: 'Орлова Мария',
    departmentId: 'dep-server',
    level: 3,
    skills: [
      { skill: 'серверы', level: 3 },
      { skill: 'резервное копирование', level: 2 },
    ],
    buildings: ['ПРОМ'],
    onShift: true,
    openTickets: 0,
    resolvedSimilar: 2,
  },
  {
    id: 'u-eng-5',
    fullName: 'Гаврилов Никита',
    departmentId: 'dep-service',
    level: 2,
    skills: [
      { skill: 'оргтехника', level: 2 },
      { skill: 'мебель', level: 1 },
    ],
    buildings: ['А', 'В'],
    onShift: false,
    openTickets: 3,
    resolvedSimilar: 1,
  },
];

/**
 * Инженеры из `data.extra.engineers`: массив или `{ engineers: [...] }`.
 * Пустой или битый набор → встроенный демо-набор, чтобы шаг не падал.
 */
export function readEngineers(data: ReferenceData): EngineerProfile[] {
  const raw: unknown = data.extra.engineers;
  if (Array.isArray(raw)) {
    const parsed = EngineerList.safeParse(raw);
    if (parsed.success && parsed.data.length > 0) return parsed.data;
    return DEMO_ENGINEERS;
  }
  if (typeof raw === 'object' && raw !== null) {
    const parsed = EngineersFile.safeParse(raw);
    if (parsed.success && parsed.data.engineers.length > 0) return parsed.data.engineers;
  }
  return DEMO_ENGINEERS;
}
