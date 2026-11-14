import { describe, expect, it } from 'vitest';
import type { Equipment, LocationNode } from '../src/ports';
import type { AgentContext, ToolDef } from '../src';
import { MemoryStore, createReferenceData } from '../src';
import { coreTools } from '../src/tools';

const locations: LocationNode[] = [
  { id: 'b-1', kind: 'building', name: 'Б', parentId: null },
  { id: 'f-1', kind: 'floor', name: '3', parentId: 'b-1' },
  { id: 'c-1', kind: 'cabinet', name: '312', parentId: 'f-1' },
  { id: 'b-2', kind: 'building', name: 'А', parentId: null },
];

function context(): AgentContext {
  const fail = async (): Promise<never> => {
    throw new Error('порт не нужен');
  };
  return {
    user: { id: 'u-1', fullName: 'Тест', role: 'applicant', departmentId: null, position: 'Заявитель' },
    ports: {
      llm: { structured: fail, chat: fail },
      embeddings: { embed: fail },
      speech: { transcribe: fail },
      vision: { describe: fail },
      cmdb: {
        async findEquipment(query) {
          return [
            {
              id: 'eq-1',
              type: query.type ?? 'принтер',
              model: 'HP LaserJet',
              serial: '0412',
              inventoryNo: null,
              ip: null,
              building: 'Б',
              cabinet: '312',
              criticality: 'medium',
            },
          ];
        },
        async locations() {
          return locations;
        },
      },
      history: { similar: async () => [] },
      notifications: { send: async () => ({ delivered: true }) },
      clock: { now: () => new Date('2026-11-14T10:00:00.000Z') },
    },
    data: createReferenceData({
      dictionaries: [
        { dictionary: 'category', code: 'print', label: 'Печать' },
        { dictionary: 'category', code: 'network', label: 'Сеть' },
        { dictionary: 'building', code: 'b', label: 'Корпус Б' },
      ],
    }),
    db: new MemoryStore(),
    clock: { now: () => new Date('2026-11-14T10:00:00.000Z') },
  };
}

function tool<A, R>(name: string): ToolDef<A, R> {
  const found = coreTools().find((item) => item.name === name);
  if (!found) throw new Error(`нет инструмента ${name}`);
  return found as unknown as ToolDef<A, R>;
}

type DictionaryArgs = { dictionary: string; query?: string };
type DictionaryResult = { variants: { value: string; label: string }[] };

describe('coreTools', () => {
  it('объявляет три инструмента с правом tickets.read', () => {
    const tools = coreTools();

    expect(tools.map((item) => item.name)).toEqual([
      'dictionary_lookup',
      'cmdb_find_equipment',
      'cmdb_list_locations',
    ]);
    for (const item of tools) {
      expect(item.description.trim()).not.toBe('');
      expect(item.capability).toBe('tickets.read');
    }
  });

  it('dictionary_lookup ищет варианты по запросу и без него', async () => {
    const lookup = tool<DictionaryArgs, DictionaryResult>('dictionary_lookup');
    const all = await lookup.execute(lookup.input.parse({ dictionary: 'category' }), context());
    expect(all).toEqual({
      variants: [
        { value: 'print', label: 'Печать' },
        { value: 'network', label: 'Сеть' },
      ],
    });

    const filtered = await lookup.execute(
      lookup.input.parse({ dictionary: 'category', query: 'сет' }),
      context(),
    );
    expect(filtered).toEqual({ variants: [{ value: 'network', label: 'Сеть' }] });
  });

  it('dictionary_lookup на неизвестном справочнике возвращает пусто', async () => {
    const lookup = tool<DictionaryArgs, DictionaryResult>('dictionary_lookup');
    const result = await lookup.execute(lookup.input.parse({ dictionary: 'нет' }), context());

    expect(result).toEqual({ variants: [] });
    expect(lookup.summarize?.(result)).toContain('0');
  });

  it('cmdb_find_equipment отдаёт технику из порта', async () => {
    const find = tool<{ building?: string; cabinet?: string }, { equipment: Equipment[] }>(
      'cmdb_find_equipment',
    );
    const input = find.input.parse({ building: 'Б', cabinet: '312' });
    const result = await find.execute(input, context());

    expect(result.equipment).toHaveLength(1);
    expect(find.summarize?.(result)).toContain('1');
  });

  it('cmdb_list_locations фильтрует по корпусу и берёт его потомков', async () => {
    const list = tool<{ building?: string }, { locations: LocationNode[] }>('cmdb_list_locations');

    const all = await list.execute(list.input.parse({}), context());
    expect(all.locations).toHaveLength(4);

    const building = await list.execute(list.input.parse({ building: 'б' }), context());
    expect(building.locations.map((node) => node.id)).toEqual(['b-1', 'f-1', 'c-1']);
  });
});
