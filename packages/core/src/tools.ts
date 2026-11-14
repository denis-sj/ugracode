import { z } from 'zod';
import type { ToolDef } from './agent';

/**
 * Инструменты ядра (раздел 4 спецификации): справочники и CMDB.
 * Модули-владельцы данных добавляют свои инструменты через `defineModule({ tools })`.
 */

const DictionaryLookupInput = z.object({
  dictionary: z.string().min(1).describe('Имя справочника: category, building, priority…'),
  query: z.string().optional().describe('Часть кода или подписи для поиска'),
});
type DictionaryLookupArgs = z.infer<typeof DictionaryLookupInput>;

interface DictionaryVariant {
  value: string;
  label: string;
}

const dictionaryLookup: ToolDef<DictionaryLookupArgs, { variants: DictionaryVariant[] }> = {
  name: 'dictionary_lookup',
  description:
    'Ищет варианты значений в справочнике (категории, корпуса, важность). Возвращает код и подпись; используй вместо догадок.',
  input: DictionaryLookupInput,
  capability: 'tickets.read',
  async execute(args, ctx) {
    const query = args.query?.trim().toLowerCase();
    const variants = ctx.data.dictionaries
      .filter((item) => item.dictionary === args.dictionary)
      .filter(
        (item) =>
          !query ||
          item.code.toLowerCase().includes(query) ||
          item.label.toLowerCase().includes(query),
      )
      .map((item) => ({ value: item.code, label: item.label }));
    return { variants };
  },
  summarize(result) {
    return `Справочник: ${result.variants.length} вариант(ов)`;
  },
};

const FindEquipmentInput = z.object({
  building: z.string().optional().describe('Корпус или здание'),
  cabinet: z.string().optional().describe('Кабинет'),
  type: z.string().optional().describe('Тип техники: принтер, МФУ, ПК…'),
  model: z.string().optional().describe('Модель'),
  serial: z.string().optional().describe('Серийный номер'),
  text: z.string().optional().describe('Свободный текст для поиска'),
});
type FindEquipmentArgs = z.infer<typeof FindEquipmentInput>;

const findEquipment: ToolDef<FindEquipmentArgs, { equipment: unknown[] }> = {
  name: 'cmdb_find_equipment',
  description:
    'Ищет технику в CMDB по корпусу, кабинету, типу, модели или серийному номеру. Возвращает найденные единицы с инвентарным номером.',
  input: FindEquipmentInput,
  capability: 'tickets.read',
  async execute(args, ctx) {
    const equipment = await ctx.ports.cmdb.findEquipment(args);
    return { equipment: equipment.slice(0, 10) };
  },
  summarize(result) {
    return `CMDB: найдено ${result.equipment.length} единиц(ы) техники`;
  },
};

const ListLocationsInput = z.object({
  building: z.string().optional().describe('Корпус или здание: вернуть его кабинеты'),
});
type ListLocationsArgs = z.infer<typeof ListLocationsInput>;

const listLocations: ToolDef<ListLocationsArgs, { locations: unknown[] }> = {
  name: 'cmdb_list_locations',
  description:
    'Список мест из CMDB: корпуса, этажи, кабинеты. С фильтром по корпусу возвращает только его узлы.',
  input: ListLocationsInput,
  capability: 'tickets.read',
  async execute(args, ctx) {
    const locations = await ctx.ports.cmdb.locations();
    const building = args.building?.trim().toLowerCase();
    if (!building) return { locations };
    const roots = locations.filter(
      (node) => node.kind === 'building' && node.name.toLowerCase() === building,
    );
    const ids = new Set(roots.map((node) => node.id));
    // Корпус → этажи → кабинеты: берём всё поддерево, а не только прямых детей.
    let added = true;
    while (added) {
      added = false;
      for (const node of locations) {
        if (node.parentId !== null && ids.has(node.parentId) && !ids.has(node.id)) {
          ids.add(node.id);
          added = true;
        }
      }
    }
    return { locations: locations.filter((node) => ids.has(node.id)) };
  },
  summarize(result) {
    return `CMDB: ${result.locations.length} мест(а)`;
  },
};

/** Все инструменты ядра: справочники и CMDB. */
export function coreTools(): ToolDef[] {
  return [dictionaryLookup, findEquipment, listLocations];
}
