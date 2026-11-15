import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { DictionariesFile, FieldsFile, PriorityLevel, Role } from '@ugra/contracts';

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

/** Уровень приоритета и сроки регламента: реакция и решение в минутах. */
export const PriorityLevelSeed = z.object({
  label: z.string().min(1),
  reactMinutes: z.number().int().positive(),
  slaMinutes: z.number().int().positive(),
  order: z.number().int().nonnegative(),
  /** true — уровень выставляет код (авария), а не матрица. */
  computed: z.boolean().optional(),
});
export type PriorityLevelSeed = z.infer<typeof PriorityLevelSeed>;

export const PriorityMatrixFile = z.object({
  levels: z.record(z.string(), PriorityLevelSeed),
  matrix: z.record(z.string(), z.record(z.string(), PriorityLevel)),
});
export type PriorityMatrixFile = z.infer<typeof PriorityMatrixFile>;

export const EmergencyChecklistSeed = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  steps: z.array(z.string().min(1)).min(1),
});
export type EmergencyChecklistSeed = z.infer<typeof EmergencyChecklistSeed>;

export const EmergencyRuleSeed = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  level: PriorityLevel,
  checklistId: z.string().min(1),
  /** Коды признаков для аспекта модели. */
  signs: z.array(z.string().min(1)).min(1),
  /** Подстроки, по которым правило срабатывает на тексте (нижний регистр). */
  patterns: z.array(z.string().min(1)).min(1),
});
export type EmergencyRuleSeed = z.infer<typeof EmergencyRuleSeed>;

export const EmergencyRulesFile = z.object({
  rules: z.array(EmergencyRuleSeed).min(1),
  checklists: z.array(EmergencyChecklistSeed).min(1),
});
export type EmergencyRulesFile = z.infer<typeof EmergencyRulesFile>;

export const EngineerSkillSeed = z.object({
  skill: z.string().min(1),
  level: z.number().int().min(1).max(5),
});
export type EngineerSkillSeed = z.infer<typeof EngineerSkillSeed>;

export const EngineerSeed = z.object({
  id: z.string().min(1),
  fullName: z.string().min(1),
  departmentId: z.string().min(1),
  level: z.enum(['first_line', 'second_line', 'lead']),
  skills: z.array(EngineerSkillSeed).min(1),
  buildings: z.array(z.string().min(1)).min(1),
  onShift: z.boolean(),
  openTickets: z.number().int().nonnegative(),
  resolvedSimilar: z.number().int().nonnegative(),
});
export type EngineerSeed = z.infer<typeof EngineerSeed>;

export const EngineersFile = z.object({ engineers: z.array(EngineerSeed).min(1) });
export type EngineersFile = z.infer<typeof EngineersFile>;

/** Профиль заявителя для предзаполнения полей места. */
export const UserProfileSeed = z.object({
  building: z.string().min(1),
  floor: z.string().min(1),
  cabinet: z.string().min(1),
  equipmentId: z.string().min(1).nullable().optional(),
});
export type UserProfileSeed = z.infer<typeof UserProfileSeed>;

export const UserSeed = z.object({
  id: z.string().min(1),
  fullName: z.string().min(1),
  role: Role,
  departmentId: z.string().nullable(),
  position: z.string().min(1),
  profile: UserProfileSeed.optional(),
});
export type UserSeed = z.infer<typeof UserSeed>;

export const UsersFile = z.object({ users: z.array(UserSeed).min(1) });
export type UsersFile = z.infer<typeof UsersFile>;

export const KbArticleSeed = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  symptoms: z.array(z.string().min(1)).min(1),
  steps: z.array(z.string().min(1)).min(1),
  solution: z.string().min(1),
  category: z.string().min(1),
});
export type KbArticleSeed = z.infer<typeof KbArticleSeed>;

export const KbFile = z.object({ articles: z.array(KbArticleSeed).min(1) });
export type KbFile = z.infer<typeof KbFile>;

export interface SeedData {
  fields: FieldsFile['fields'];
  dictionaries: DictionariesFile['items'];
  settings: Record<string, unknown>;
  cmdb: CmdbFile;
  priorityMatrix: PriorityMatrixFile;
  emergencyRules: EmergencyRulesFile;
  engineers: EngineersFile['engineers'];
  users: UsersFile['users'];
  kbArticles: KbFile['articles'];
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

/** Все статьи базы знаний лежат по одной-три в файле `data/kb/*.json`. */
function loadKbArticles(dir: string): KbFile['articles'] {
  const kbDir = `${dir}kb/`;
  if (!existsSync(kbDir)) return [];
  return readdirSync(kbDir)
    .filter((name) => name.endsWith('.json'))
    .sort((left, right) => left.localeCompare(right))
    .flatMap((name) => KbFile.parse(readJson(`${kbDir}${name}`)).articles);
}

/** Читает и проверяет схемы `data/*.json`. Без этого seed падает громко, а не молча. */
export function loadSeedData(dir = DEFAULT_DATA_DIR): SeedData {
  const fields = FieldsFile.parse(readJson(`${dir}fields.json`));
  const dictionaries = DictionariesFile.parse(readJson(`${dir}dictionaries.json`));
  const settings = SettingsFile.parse(readJson(`${dir}settings.json`));
  const cmdb = CmdbFile.parse(readJson(`${dir}cmdb.json`));
  const priorityMatrix = PriorityMatrixFile.parse(readJson(`${dir}priority-matrix.json`));
  const emergencyRules = EmergencyRulesFile.parse(readJson(`${dir}emergency-rules.json`));
  const engineers = EngineersFile.parse(readJson(`${dir}engineers.json`));
  const users = UsersFile.parse(readJson(`${dir}users.json`));
  return {
    fields: fields.fields,
    dictionaries: dictionaries.items,
    settings: settings.settings,
    cmdb,
    priorityMatrix,
    emergencyRules,
    engineers: engineers.engineers,
    users: users.users,
    kbArticles: loadKbArticles(dir),
  };
}
