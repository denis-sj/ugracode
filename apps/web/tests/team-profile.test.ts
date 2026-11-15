import { describe, expect, it } from 'vitest';
import type { User } from '@ugra/contracts';
import { equipmentChoices } from '../src/screens/profile-format';
import { ROLE_OPTIONS, roleTitle, teamGroups } from '../src/screens/team-format';

const person = (id: string, fullName: string, role: User['role']): User => ({
  id,
  fullName,
  role,
  departmentId: null,
  position: 'x',
});

describe('сотрудники по ролям', () => {
  it('группы в порядке «руководители → заявители», внутри по алфавиту, без служебных учёток', () => {
    const groups = teamGroups([
      person('u-applicant-2', 'Ирина Волкова', 'applicant'),
      person('u-applicant-1', 'Денис Соколов', 'applicant'),
      person('u-manager-1', 'Ольга Ветрова', 'manager'),
      person('guest', 'Гость', 'applicant'),
      person('u-call-guest', 'Звонок', 'applicant'),
    ]);
    expect(groups.map((group) => group.title)).toEqual(['Руководители', 'Заявители']);
    expect(groups[1]?.users.map((user) => user.fullName)).toEqual(['Денис Соколов', 'Ирина Волкова']);
  });

  it('пустой список — пустые группы не показываем', () => {
    expect(teamGroups([])).toEqual([]);
  });

  it('роли по-русски', () => {
    expect(ROLE_OPTIONS.map((option) => option.label)).toContain('Диспетчер');
    expect(roleTitle('manager')).toBe('Руководитель');
  });
});

describe('выбор техники в профиле', () => {
  const catalog = [
    { id: 'eq-a', label: 'ПК Dell', building: 'А', cabinet: '101' },
    { id: 'eq-b2', label: 'Принтер HP', building: 'Б', cabinet: '205' },
    { id: 'eq-b1', label: 'ПК HP', building: 'Б', cabinet: '312' },
    { id: 'eq-x', label: 'Сервер', building: null, cabinet: null },
  ];
  const profile = { userId: 'u', building: 'Б', floor: '3', cabinet: '312', equipmentId: null };

  it('сначала свой кабинет, потом корпус, закреплённая техника исключена', () => {
    const taken = [{ id: 'aeq', equipmentId: 'eq-b2', note: null }];
    const choices = equipmentChoices(catalog, profile, taken);
    expect(choices.map((choice) => choice.value)).toEqual(['eq-b1', 'eq-a', 'eq-x']);
    expect(choices[0]?.label).toBe('ПК HP · Б-312');
    expect(choices[2]?.label).toBe('Сервер');
  });

  it('без профиля — всё по алфавиту', () => {
    const choices = equipmentChoices(catalog, null, []);
    expect(choices.map((choice) => choice.value)).toEqual(['eq-a', 'eq-b1', 'eq-b2', 'eq-x']);
  });
});
