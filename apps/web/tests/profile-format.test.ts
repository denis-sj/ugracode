import { describe, expect, it } from 'vitest';
import type { MetaResponse, ProfileResponse } from '@ugra/contracts';
import { departmentLabel, equipmentLine, placeLabel, profileFilled } from '../src/screens/profile-format';

const meta = {
  modules: [],
  fields: [],
  dictionaries: [
    { dictionary: 'department', code: 'dep-it', label: 'ИТ-служба' },
    { dictionary: 'department', code: 'dep-service', label: 'Сервисная служба' },
  ],
  aiMode: 'stub',
  roles: ['applicant', 'dispatcher', 'engineer', 'manager', 'admin'],
  priorities: ['emergency', 'critical', 'high', 'medium', 'low'],
} as unknown as MetaResponse;

const profile: ProfileResponse['profile'] = {
  userId: 'u-1',
  building: 'Б',
  floor: '3',
  cabinet: '311',
  equipmentId: 'eq-pc-b311',
};

describe('profile-format', () => {
  it('переводит код подразделения в подпись', () => {
    expect(departmentLabel(meta, 'dep-it')).toBe('ИТ-служба');
    expect(departmentLabel(meta, 'dep-unknown')).toBe('dep-unknown');
    expect(departmentLabel(meta, null)).toBe('Не указано');
  });

  it('собирает место из профиля', () => {
    expect(placeLabel(profile)).toBe('Корпус Б · 3 этаж · каб. 311');
    expect(placeLabel({ ...profile, floor: null })).toBe('Корпус Б · каб. 311');
    expect(placeLabel(null)).toBeNull();
  });

  it('показывает технику: подпись CMDB, иначе идентификатор', () => {
    expect(equipmentLine({ id: '1', equipmentId: 'eq-1', note: null, label: 'ПК Dell' })).toBe('ПК Dell');
    expect(equipmentLine({ id: '1', equipmentId: 'eq-1', note: null })).toBe('eq-1');
  });

  it('определяет заполненность профиля', () => {
    expect(profileFilled(profile, [])).toBe(true);
    expect(profileFilled(null, [])).toBe(false);
    expect(profileFilled(null, [{ id: '1', equipmentId: 'eq-1', note: null }])).toBe(true);
  });
});
