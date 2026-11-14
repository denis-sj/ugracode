import type { HistorySeedInput } from '../server/generator';

/** Небольшой, но полный набор данных для генератора: инженеры, техника, справочники. */
export function makeHistoryInput(overrides: Partial<HistorySeedInput> = {}): HistorySeedInput {
  return {
    now: new Date('2026-11-14T12:00:00.000Z'),
    count: 600,
    months: 6,
    seed: 42,
    users: [
      { id: 'u-applicant-1', fullName: 'Денис Соколов' },
      { id: 'u-applicant-2', fullName: 'Ирина Волкова' },
    ],
    engineers: [
      {
        id: 'u-engineer-2',
        fullName: 'Артём Кузнецов',
        departmentId: 'dep-it',
        skills: ['printer', 'mfu'],
        buildings: ['А', 'Б'],
      },
      {
        id: 'u-engineer-7',
        fullName: 'Дмитрий Ковалёв',
        departmentId: 'dep-network',
        skills: ['network'],
        buildings: ['Б', 'ПРОМ'],
      },
      {
        id: 'u-engineer-10',
        fullName: 'Екатерина Лаврова',
        departmentId: 'dep-software',
        skills: ['1c'],
        buildings: ['А', 'Б'],
      },
      {
        id: 'u-engineer-12',
        fullName: 'Виктор Самойлов',
        departmentId: 'dep-server',
        skills: ['server'],
        buildings: ['Б', 'ПРОМ'],
      },
    ],
    equipment: [
      {
        id: 'eq-printer-b312',
        type: 'printer',
        model: 'HP LaserJet Pro M404dn',
        building: 'Б',
        cabinet: '312',
      },
      { id: 'eq-pc-b312', type: 'pc', model: 'HP ProDesk 400 G9', building: 'Б', cabinet: '312' },
      { id: 'eq-printer-a101', type: 'printer', model: 'Kyocera ECOSYS', building: 'А', cabinet: '101' },
      { id: 'eq-switch-b3', type: 'network', model: 'Cisco Catalyst 2960', building: 'Б', cabinet: '210' },
      { id: 'eq-server-b1', type: 'server', model: 'Dell PowerEdge R650', building: 'Б', cabinet: '104' },
    ],
    categories: ['printer', 'pc', 'network', 'software', 'server', 'peripheral'],
    buildings: ['А', 'Б', 'В', 'ПРОМ'],
    ...overrides,
  };
}
