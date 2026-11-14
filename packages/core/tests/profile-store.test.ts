import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../src';
import type { ApplicantEquipment } from '../src';

function equipment(id: string, userId: string, equipmentId: string): ApplicantEquipment {
  return { id, userId, equipmentId, note: null };
}

describe('MemoryStore: профиль заявителя', () => {
  it('сохраняет профиль и ставит время обновления', async () => {
    const store = new MemoryStore();
    const before = new Date().toISOString();
    await store.saveApplicantProfile({
      userId: 'u-1',
      building: 'Б',
      floor: '3',
      cabinet: '312',
      equipmentId: 'eq-b312-pc1',
    });

    const saved = await store.getApplicantProfile('u-1');
    expect(saved).toMatchObject({
      userId: 'u-1',
      building: 'Б',
      floor: '3',
      cabinet: '312',
      equipmentId: 'eq-b312-pc1',
    });
    expect(saved?.updatedAt).toBeDefined();
    expect(saved?.updatedAt && saved.updatedAt >= before).toBe(true);
  });

  it('повторное сохранение обновляет профиль, а не добавляет второй', async () => {
    const store = new MemoryStore();
    await store.saveApplicantProfile({
      userId: 'u-1',
      building: 'Б',
      floor: '3',
      cabinet: '312',
      equipmentId: null,
    });
    await store.saveApplicantProfile({
      userId: 'u-1',
      building: 'А',
      floor: '1',
      cabinet: '101',
      equipmentId: 'eq-a101-pc1',
      updatedAt: '2026-11-14T10:00:00.000Z',
    });

    const saved = await store.getApplicantProfile('u-1');
    expect(saved).toEqual({
      userId: 'u-1',
      building: 'А',
      floor: '1',
      cabinet: '101',
      equipmentId: 'eq-a101-pc1',
      updatedAt: '2026-11-14T10:00:00.000Z',
    });
  });

  it('нет профиля (гость) — null', async () => {
    const store = new MemoryStore();
    expect(await store.getApplicantProfile('guest')).toBeNull();
    expect(await store.listApplicantEquipment('guest')).toEqual([]);
  });

  it('список техники: только своя и копия, исходные записи не меняются', async () => {
    const store = new MemoryStore();
    const record = equipment('aeq-1', 'u-1', 'eq-b312-pc1');
    await store.saveApplicantEquipment(record);
    await store.saveApplicantEquipment(equipment('aeq-2', 'u-2', 'eq-a101-pc1'));

    const list = await store.listApplicantEquipment('u-1');
    expect(list).toEqual([record]);

    list[0]!.note = 'испорченная копия';
    expect(await store.listApplicantEquipment('u-1')).toEqual([record]);
  });
});
