import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { DictionariesFile, FieldsFile } from '@ugra/contracts';

export const CmdbLocationSeed = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  name: z.string().min(1),
  parentId: z.string().nullable(),
});
export type CmdbLocationSeed = z.infer<typeof CmdbLocationSeed>;

export const CmdbEquipmentSeed = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  model: z.string().min(1),
  serial: z.string().nullable().optional(),
  inventoryNo: z.string().nullable().optional(),
  ip: z.string().nullable().optional(),
  building: z.string().min(1),
  cabinet: z.string().min(1),
  criticality: z.enum(['critical', 'high', 'medium', 'low']),
});
export type CmdbEquipmentSeed = z.infer<typeof CmdbEquipmentSeed>;

export const CmdbFile = z.object({
  locations: z.array(CmdbLocationSeed),
  equipment: z.array(CmdbEquipmentSeed),
});
export type CmdbFile = z.infer<typeof CmdbFile>;

export const SettingsFile = z.object({ settings: z.record(z.string(), z.unknown()) });
export type SettingsFile = z.infer<typeof SettingsFile>;

export interface SeedData {
  fields: FieldsFile['fields'];
  dictionaries: DictionariesFile['items'];
  settings: Record<string, unknown>;
  cmdb: CmdbFile;
}

const DEFAULT_DATA_DIR = fileURLToPath(new URL('../../../../data/', import.meta.url));

const BUILDING_IDS: Record<string, string> = {
  А: 'bld-a',
  Б: 'bld-b',
  В: 'bld-v',
  ПРОМ: 'bld-prom',
};

const BUILDING_LABELS: Record<string, string> = {
  А: 'Корпус А',
  Б: 'Корпус Б',
  В: 'Корпус В',
  ПРОМ: 'Промплощадка',
};

/** Стабильный id корпуса: известные корпуса — из карты, иначе из кода. */
export function buildingLocationId(building: string): string {
  return BUILDING_IDS[building] ?? `bld-${building.toLowerCase()}`;
}

function buildingLabel(building: string): string {
  return BUILDING_LABELS[building] ?? `Корпус ${building}`;
}

/**
 * Строит локации по оборудованию: корпус + кабинет.
 * Нужно, чтобы у оборудования из любого корпуса был путь в дереве CMDB.
 */
export function buildLocations(equipment: readonly CmdbEquipmentSeed[]): CmdbLocationSeed[] {
  const locations = new Map<string, CmdbLocationSeed>();
  for (const item of equipment) {
    const buildingId = buildingLocationId(item.building);
    if (!locations.has(buildingId)) {
      locations.set(buildingId, {
        id: buildingId,
        kind: 'building',
        name: buildingLabel(item.building),
        parentId: null,
      });
    }
    const cabinetId = `cab-${buildingId.replace('bld-', '')}-${item.cabinet}`;
    if (!locations.has(cabinetId)) {
      locations.set(cabinetId, {
        id: cabinetId,
        kind: 'cabinet',
        name: `Каб. ${item.cabinet}`,
        parentId: buildingId,
      });
    }
  }
  return [...locations.values()];
}

/** Явные локации приоритетнее вычисленных: те же id не дублируются. */
export function mergeLocations(
  locations: readonly CmdbLocationSeed[],
  equipment: readonly CmdbEquipmentSeed[],
): CmdbLocationSeed[] {
  const seen = new Set(locations.map((location) => location.id));
  const result = [...locations];
  for (const generated of buildLocations(equipment)) {
    if (seen.has(generated.id)) continue;
    seen.add(generated.id);
    result.push(generated);
  }
  return result;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

/** Читает и проверяет схемы `data/*.json`. Без этого seed падает громко, а не молча. */
export function loadSeedData(dir = DEFAULT_DATA_DIR): SeedData {
  const fields = FieldsFile.parse(readJson(`${dir}fields.json`));
  const dictionaries = DictionariesFile.parse(readJson(`${dir}dictionaries.json`));
  const settings = SettingsFile.parse(readJson(`${dir}settings.json`));
  const cmdb = CmdbFile.parse(readJson(`${dir}cmdb.json`));
  return {
    fields: fields.fields,
    dictionaries: dictionaries.items,
    settings: settings.settings,
    cmdb,
  };
}
