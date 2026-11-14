import { describe, expect, it } from 'vitest';
import { DictionariesFile } from '@ugra/contracts';
import {
  buildLocations,
  buildingLocationId,
  loadSeedData,
  mergeLocations,
} from '../src/seed/load-data';

const data = loadSeedData();

describe('data/*.json', () => {
  it('поля проходят схему контрактов и содержат базовый набор', () => {
    const keys = data.fields.map((field) => field.key);
    expect(keys).toEqual([
      'object',
      'building',
      'cabinet',
      'equipment',
      'category',
      'impact',
      'urgency',
    ]);
    const cabinet = data.fields.find((field) => field.key === 'cabinet');
    expect(cabinet?.pattern).toBe('^[0-9]{1,4}$');
    expect(cabinet?.ask?.widget).toBe('text');
  });

  it('справочники проходят схему контрактов', () => {
    const parsed = DictionariesFile.parse({ items: data.dictionaries });
    expect(parsed.items.length).toBeGreaterThan(0);
    for (const name of ['building', 'category', 'impact', 'urgency', 'channel']) {
      expect(data.dictionaries.some((item) => item.dictionary === name)).toBe(true);
    }
  });

  it('настройки — числа', () => {
    expect(data.settings.confidenceThreshold).toBe(0.75);
    expect(data.settings.massWindowMinutes).toBe(15);
    expect(data.settings.massThreshold).toBe(5);
  });

  it('в CMDB есть принтер в корпусе Б, кабинет 312', () => {
    const printer = data.cmdb.equipment.find((item) => item.id === 'eq-printer-b312');
    expect(printer).toMatchObject({
      type: 'printer',
      model: 'HP LaserJet Pro M404dn',
      building: 'Б',
      cabinet: '312',
      criticality: 'high',
    });
  });

  it('явные локации покрывают корпуса и кабинеты Б', () => {
    const ids = data.cmdb.locations.map((location) => location.id);
    expect(ids).toContain('bld-a');
    expect(ids).toContain('bld-b');
    expect(ids).toContain('bld-v');
    expect(ids).toContain('bld-prom');
    expect(ids).toContain('cab-b-312');
    expect(ids).toContain('cab-b-311');
  });
});

describe('buildLocations', () => {
  it('строит корпус и кабинет по оборудованию', () => {
    const locations = buildLocations([
      {
        id: 'eq-x',
        type: 'pc',
        model: 'Test PC',
        building: 'А',
        cabinet: '101',
        criticality: 'low',
      },
    ]);
    expect(locations).toEqual([
      { id: 'bld-a', kind: 'building', name: 'Корпус А', parentId: null },
      { id: 'cab-a-101', kind: 'cabinet', name: 'Каб. 101', parentId: 'bld-a' },
    ]);
  });

  it('не дублирует один и тот же кабинет', () => {
    const locations = buildLocations([
      { id: 'eq-1', type: 'pc', model: 'A', building: 'В', cabinet: '205', criticality: 'low' },
      { id: 'eq-2', type: 'pc', model: 'B', building: 'В', cabinet: '205', criticality: 'high' },
    ]);
    expect(locations).toHaveLength(2);
  });

  it('даёт стабильный id для неизвестного корпуса', () => {
    expect(buildingLocationId('Г')).toBe('bld-г');
  });
});

describe('mergeLocations', () => {
  it('явные локации приоритетнее вычисленных', () => {
    const merged = mergeLocations(data.cmdb.locations, [
      {
        id: 'eq-x',
        type: 'printer',
        model: 'Test',
        building: 'Б',
        cabinet: '312',
        criticality: 'medium',
      },
    ]);
    const cabinets = merged.filter((location) => location.id === 'cab-b-312');
    expect(cabinets).toHaveLength(1);
    expect(cabinets[0]?.parentId).toBe('floor-b-3');
  });

  it('добавляет кабинет из другого корпуса', () => {
    const merged = mergeLocations(data.cmdb.locations, [
      {
        id: 'eq-y',
        type: 'pc',
        model: 'Test',
        building: 'А',
        cabinet: '101',
        criticality: 'low',
      },
    ]);
    expect(merged.some((location) => location.id === 'cab-a-101')).toBe(true);
  });
});
