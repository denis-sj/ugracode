import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { StubCmdb, parseEquipment } from '@ugra/adapters';

describe('StubCmdb', () => {
  const cmdb = new StubCmdb();

  it('находит оборудование по кабинету', async () => {
    const found = await cmdb.findEquipment({ cabinet: '312' });

    expect(found).toHaveLength(1);
    expect(found[0]?.model).toBe('HP LaserJet Pro M404dn');
    expect(found[0]?.building).toBe('Б');
    expect(found[0]?.criticality).toBe('high');
  });

  it('поиск регистронезависимый по тексту и модели', async () => {
    const byModel = await cmdb.findEquipment({ model: 'laserjet' });
    const byText = await cmdb.findEquipment({ text: 'hp' });

    expect(byModel).toHaveLength(1);
    expect(byText).toHaveLength(1);
  });

  it('возвращает пустой список, если ничего не найдено', async () => {
    const found = await cmdb.findEquipment({ cabinet: '999' });

    expect(found).toEqual([]);
  });

  it('строит иерархию building → floor → cabinet', async () => {
    const locations = await cmdb.locations();
    const building = locations.find((node) => node.kind === 'building');
    const floor = locations.find((node) => node.kind === 'floor');
    const cabinet = locations.find((node) => node.kind === 'cabinet');

    expect(building).toMatchObject({ name: 'Б', parentId: null });
    expect(floor?.parentId).toBe(building?.id);
    expect(floor?.name).toBe('3 этаж');
    expect(cabinet?.parentId).toBe(floor?.id);
    expect(cabinet?.name).toBe('каб. 312');
  });

  it('принимает оборудование из JSON', async () => {
    const items = parseEquipment([
      { id: 'x', type: 'pc', model: 'Test', building: 'А', cabinet: '101' },
    ]);

    expect(items[0]).toMatchObject({ id: 'x', criticality: 'medium', serial: null });
    await expect(cmdb.findEquipment({})).resolves.toHaveLength(1);
    expect(await new StubCmdb(items).findEquipment({ cabinet: '101' })).toHaveLength(1);
  });

  it('принимает файл data/cmdb.json как объект с locations и equipment', async () => {
    const raw = JSON.parse(readFileSync(join(process.cwd(), 'data/cmdb.json'), 'utf8')) as { equipment: unknown[] };
    const items = parseEquipment(raw);

    expect(items).toHaveLength(raw.equipment.length);
    const pcs = await new StubCmdb(items).findEquipment({ building: 'Б', cabinet: '311', type: 'pc' });
    expect(pcs.map((item) => item.model)).toEqual(['Dell OptiPlex 7010']);
  });

  it('битый файл — ошибка разбора, а не тихая подмена', () => {
    expect(() => parseEquipment({ equipment: [{ id: 'x' }] })).toThrow();
    expect(() => parseEquipment({ locations: [] })).toThrow();
  });
});
