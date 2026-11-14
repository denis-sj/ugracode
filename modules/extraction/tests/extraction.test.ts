import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DictionariesFile, FieldsFile } from '@ugra/contracts';
import type { AnalysisDraft, Appeal } from '@ugra/contracts';
import type {
  AgentContext,
  Equipment,
  EquipmentQuery,
  LocationNode,
  ReferenceData,
  StepContext,
  StepProgress,
} from '@ugra/core';
import { MemoryStore, createReferenceData } from '@ugra/core';
import { StubLlm } from '@ugra/adapters';
import type { ScenarioTurn } from '@ugra/adapters';
import extraction from '../server';
import { checkIntake } from '../server/intake';
import { readExtractionExtras } from '../contracts';
import { locationIdFor } from '../server/ground';

const root = process.cwd();
const fields = FieldsFile.parse(JSON.parse(readFileSync(join(root, 'data/fields.json'), 'utf8'))).fields;
const dictionaries = DictionariesFile.parse(
  JSON.parse(readFileSync(join(root, 'data/dictionaries.json'), 'utf8')),
).items;
const cmdbFile = JSON.parse(readFileSync(join(root, 'data/cmdb.json'), 'utf8')) as {
  locations: LocationNode[];
  equipment: Equipment[];
};

const appealText =
  'Здравствуйте! В корпусе Б, кабинет 312, принтер HP LaserJet Pro M404dn мигает красный индикатор и ничего не печатает.';

const appeal: Appeal = {
  id: 'a-1',
  channel: 'chat',
  authorId: 'u-1',
  originalText: appealText,
  attachments: [],
  createdAt: '2026-11-14T10:00:00.000Z',
};

const now = new Date('2026-11-14T10:00:00.000Z');

function data(patch: Partial<ReferenceData> = {}): ReferenceData {
  return createReferenceData({
    fields,
    dictionaries,
    settings: { confidenceThreshold: 0.75 },
    ...patch,
  });
}

function queryMatch(value: string | null, query: string | undefined): boolean {
  return query === undefined || (value !== null && value.toLowerCase().includes(query.toLowerCase()));
}

function cmdbPort(
  equipment: readonly Equipment[] = cmdbFile.equipment,
  locations: readonly LocationNode[] = cmdbFile.locations,
): AgentContext['ports']['cmdb'] {
  return {
    async findEquipment(query: EquipmentQuery) {
      return equipment.filter(
        (item) =>
          queryMatch(item.building, query.building) &&
          queryMatch(item.cabinet, query.cabinet) &&
          queryMatch(item.type, query.type) &&
          queryMatch(item.model, query.model) &&
          queryMatch(item.serial, query.serial) &&
          queryMatch(item.inventoryNo, query.inventoryNo) &&
          queryMatch(item.ip, query.ip),
      );
    },
    async locations() {
      return [...locations];
    },
  };
}

async function notConfigured(): Promise<never> {
  throw new Error('порт не нужен в этом тесте');
}

function portsWith(scenario: ScenarioTurn[], cmdb = cmdbPort()): AgentContext['ports'] {
  return {
    llm: new StubLlm({}, { scenario }),
    embeddings: { embed: notConfigured },
    speech: { transcribe: notConfigured },
    vision: { describe: notConfigured },
    cmdb,
    history: { similar: notConfigured },
    notifications: { send: async () => ({ delivered: true }) },
    clock: { now: () => now },
  };
}

function draft(patch: Partial<AnalysisDraft> = {}): AnalysisDraft {
  return {
    sources: [{ id: appeal.id, kind: 'text', text: appealText }],
    fields: {},
    missing: [],
    ext: {},
    ...patch,
  };
}

function context(options: {
  draft: AnalysisDraft;
  ports?: AgentContext['ports'];
  data?: ReferenceData;
  onProgress?: (progress: StepProgress) => void;
}): StepContext {
  return {
    runId: 'run-1',
    appeal,
    draft: options.draft,
    ports: options.ports ?? portsWith([]),
    data: options.data ?? data(),
    progress: options.onProgress ?? (() => undefined),
    trace: () => undefined,
    signal: new AbortController().signal,
  };
}

function agentContext(): AgentContext {
  return {
    user: {
      id: 'u-1',
      fullName: 'Заявитель',
      role: 'applicant',
      departmentId: null,
      position: 'Заявитель',
    },
    appeal,
    ports: portsWith([]),
    data: data(),
    db: new MemoryStore(),
    clock: { now: () => now },
  };
}

const successSubmit = {
  fields: [
    { key: 'building', value: 'Б', quote: 'корпусе Б', confidence: 0.98 },
    { key: 'cabinet', value: '312', quote: 'кабинет 312', confidence: 0.98 },
    {
      key: 'equipment',
      value: 'HP LaserJet Pro M404dn',
      quote: 'принтер HP LaserJet Pro M404dn',
      confidence: 0.95,
    },
    { key: 'model', value: 'HP LaserJet Pro M404dn', quote: 'HP LaserJet Pro M404dn', confidence: 0.95 },
    { key: 'category', value: 'printer', quote: 'принтер', confidence: 0.97 },
    {
      key: 'symptoms',
      value: 'мигает красный индикатор',
      quote: 'мигает красный индикатор',
      confidence: 0.94,
    },
  ],
  emergency: { suspected: false, signs: [], confidence: 0.1 },
  clarify: null,
  summary: 'Принтер HP в кабинете 312 не печатает, мигает красный индикатор.',
};

const intakeStep = extraction.steps.find((step) => step.id === 'agent.intake');
const groundStep = extraction.steps.find((step) => step.id === 'extraction.ground');

function stepOf(id: string) {
  const step = extraction.steps.find((item) => item.id === id);
  if (!step) throw new Error(`шаг ${id} не зарегистрирован`);
  return step;
}

describe('extraction: агент intake', () => {
  it('собирает поля с цитатами, вызывает CMDB и кладёт итог в ext', async () => {
    const seen: StepProgress[] = [];
    const scenario: ScenarioTurn[] = [
      {
        toolCalls: [
          { name: 'cmdb_find_equipment', arguments: { building: 'Б', cabinet: '312', type: 'printer' } },
        ],
      },
      { submit: successSubmit },
    ];

    const patch = await stepOf('agent.intake').run(
      context({ draft: draft(), ports: portsWith(scenario), onProgress: (item) => seen.push(item) }),
    );

    expect(patch?.fields?.building?.value).toBe('Б');
    expect(patch?.fields?.building?.quote).toEqual({ sourceId: appeal.id, text: 'корпусе Б' });
    expect(patch?.fields?.building?.origin).toBe('text');
    expect(patch?.fields?.building?.trace[0]?.kind).toBe('found');
    expect(patch?.fields?.category?.value).toBe('printer');
    expect(readExtractionExtras(patch?.ext)?.summary).toContain('кабинете 312');
    expect(seen.flatMap((item) => item.fields ?? [])).toContain('building');
    expect(seen.some((item) => item.message?.includes('cmdb_find_equipment'))).toBe(true);
  });

  it('отклоняет выдуманную цитату и показывает ошибку модели', async () => {
    expect(
      checkIntake(
        {
          ...successSubmit,
          fields: [{ key: 'building', value: 'Б', quote: 'корпусе В', confidence: 0.9 }],
        },
        agentContext(),
      ).join(' '),
    ).toMatch(/цитаты нет в тексте/);

    const scenario: ScenarioTurn[] = [
      {
        submit: {
          ...successSubmit,
          fields: [{ key: 'building', value: 'Б', quote: 'корпусе В', confidence: 0.9 }],
        },
      },
    ];
    await expect(
      stepOf('agent.intake').run(context({ draft: draft(), ports: portsWith(scenario) })),
    ).rejects.toThrow(/не выполнил разбор/);
  });

  it('после ошибки проверки модель исправляет цитату и сдаёт результат', async () => {
    const bad = {
      ...successSubmit,
      fields: [{ key: 'building', value: 'Б', quote: 'корпусе В', confidence: 0.9 }],
    };
    const scenario: ScenarioTurn[] = [{ submit: bad }, { submit: successSubmit }];

    const patch = await stepOf('agent.intake').run(context({ draft: draft(), ports: portsWith(scenario) }));

    expect(patch?.fields?.building?.value).toBe('Б');
    expect(patch?.fields?.building?.quote?.text).toBe('корпусе Б');
  });

  it('отбрасывает значение вне справочника', async () => {
    const bad = {
      ...successSubmit,
      fields: [{ key: 'building', value: 'корпус Б', quote: 'корпусе Б', confidence: 0.9 }],
    };
    expect(checkIntake(bad, agentContext()).join(' ')).toMatch(/не из справочника building/);

    const scenario: ScenarioTurn[] = [{ submit: bad }];
    await expect(
      stepOf('agent.intake').run(context({ draft: draft(), ports: portsWith(scenario) })),
    ).rejects.toThrow(/не выполнил разбор/);
  });

  it('сообщает модели о поле вне реестра и признаке аварии без цитаты', () => {
    const result = checkIntake(
      {
        ...successSubmit,
        fields: [...successSubmit.fields, { key: 'unknown', value: 'x', quote: 'принтер', confidence: 0.5 }],
        emergency: { suspected: true, signs: [{ sign: 'smoke', quote: 'дымит' }], confidence: 0.9 },
      },
      agentContext(),
    ).join(' ');

    expect(result).toMatch(/поля «unknown» нет в реестре/);
    expect(result).toMatch(/признак аварии «smoke»/);
  });

  it('ищет цитату по всем источникам и запоминает, откуда она', async () => {
    const answer = { id: 'answer-1', kind: 'answer' as const, text: 'Уточняю: корпус В, кабинет 105' };
    const scenario: ScenarioTurn[] = [
      {
        submit: {
          fields: [
            { key: 'building', value: 'В', quote: 'корпус В', confidence: 0.9 },
            { key: 'cabinet', value: '105', quote: 'кабинет 105', confidence: 0.9 },
          ],
          emergency: { suspected: false, signs: [], confidence: 0.1 },
          clarify: null,
          summary: 'Уточнили место.',
        },
      },
    ];

    const patch = await stepOf('agent.intake').run(
      context({
        draft: draft({ sources: [...draft().sources, answer] }),
        ports: portsWith(scenario),
      }),
    );

    expect(patch?.fields?.building?.value).toBe('В');
    expect(patch?.fields?.building?.quote).toEqual({ sourceId: 'answer-1', text: 'корпус В' });
  });

  it('не стартует без текста обращения', async () => {
    await expect(
      intakeStep?.run(context({ draft: draft({ sources: [] }), ports: portsWith([]) })),
    ).rejects.toThrow(/нет текста/);
  });

  it('спрашивает справочник и CMDB в сценарии из нескольких шагов', async () => {
    const scenario: ScenarioTurn[] = [
      {
        toolCalls: [
          { name: 'dictionary_lookup', arguments: { dictionary: 'category', query: 'print' } },
          { name: 'cmdb_list_locations', arguments: { building: 'Б' } },
        ],
      },
      { submit: successSubmit },
    ];

    const patch = await stepOf('agent.intake').run(context({ draft: draft(), ports: portsWith(scenario) }));

    expect(patch?.fields?.cabinet?.value).toBe('312');
  });
});

describe('extraction: проверки кодом (ground)', () => {
  it('добавляет инвентарный номер, IP и связки CMDB', async () => {
    const intake = await stepOf('agent.intake').run(
      context({
        draft: draft(),
        ports: portsWith([{ submit: successSubmit }]),
      }),
    );

    const patch = await groundStep?.run(
      context({ draft: draft({ fields: intake?.fields ?? {}, ext: intake?.ext ?? {} }) }),
    );
    const extras = readExtractionExtras(patch?.ext);

    expect(patch?.fields?.inventoryNo?.value).toBe('INV-000312');
    expect(patch?.fields?.inventoryNo?.origin).toBe('cmdb');
    expect(patch?.fields?.ip?.value).toBe('10.10.3.12');
    expect(extras?.cmdb?.equipmentId).toBe('eq-printer-b312');
    expect(extras?.cmdb?.locationId).toBe('cab-b-312');
    expect(extras?.cmdb?.criticality).toBe('high');
  });

  it('несколько совпадений в CMDB → поле на проверку диспетчеру', async () => {
    const first = cmdbFile.equipment.find((item) => item.id === 'eq-printer-b312');
    if (!first) throw new Error('нет тестовой техники');
    const two = [first, { ...first, id: 'eq-printer-b312-2', inventoryNo: 'INV-000313' }];
    const base = await stepOf('agent.intake').run(
      context({ draft: draft(), ports: portsWith([{ submit: successSubmit }]) }),
    );

    const patch = await groundStep?.run(
      context({
        draft: draft({ fields: base?.fields ?? {}, ext: base?.ext ?? {} }),
        ports: portsWith([], cmdbPort(two)),
      }),
    );

    expect(patch?.fields?.equipment?.needsReview).toBe(true);
    expect(patch?.fields?.inventoryNo).toBeUndefined();
    expect(readExtractionExtras(patch?.ext)?.cmdb).toBeUndefined();
  });

  it('низкая уверенность ниже порога → needsReview', async () => {
    const patch = await groundStep?.run(
      context({
        draft: draft({
          fields: {
            building: {
              key: 'building',
              value: 'Б',
              confidence: 0.5,
              quote: { sourceId: appeal.id, text: 'корпусе Б' },
              origin: 'text',
              needsReview: false,
              trace: [],
            },
          },
        }),
      }),
    );

    expect(patch?.fields?.building?.needsReview).toBe(true);
    expect(patch?.fields?.building?.value).toBe('Б');
  });

  it('отбрасывает значение вне справочника и цитату не из текста', async () => {
    const patch = await groundStep?.run(
      context({
        draft: draft({
          fields: {
            building: {
              key: 'building',
              value: 'К',
              confidence: 0.9,
              quote: { sourceId: appeal.id, text: 'корпусе Б' },
              origin: 'text',
              needsReview: false,
              trace: [],
            },
            cabinet: {
              key: 'cabinet',
              value: '312',
              confidence: 0.9,
              quote: { sourceId: appeal.id, text: 'кабинет 999' },
              origin: 'text',
              needsReview: false,
              trace: [],
            },
          },
        }),
      }),
    );

    expect(patch?.fields?.building?.value).toBeNull();
    expect(patch?.fields?.building?.trace.at(-1)?.kind).toBe('rejected');
    expect(patch?.fields?.cabinet?.value).toBeNull();
    expect(patch?.fields?.cabinet?.needsReview).toBe(true);
  });

  it('находит кабинет в дереве CMDB и не путает корпуса', () => {
    expect(locationIdFor(cmdbFile.locations, 'Б', '312')).toBe('cab-b-312');
    expect(locationIdFor(cmdbFile.locations, 'А', '312')).toBeNull();
  });
});

describe('extraction: оценка точности', () => {
  it('считает попадания по полям эталона и общую долю', () => {
    const metrics =
      intakeStep?.evaluate?.(
        { fields: { building: 'Б', cabinet: '999', equipment: null } },
        draft({
          fields: {
            building: {
              key: 'building',
              value: 'Б',
              confidence: 0.9,
              quote: null,
              origin: 'text',
              needsReview: false,
              trace: [],
            },
            cabinet: {
              key: 'cabinet',
              value: '312',
              confidence: 0.9,
              quote: null,
              origin: 'text',
              needsReview: false,
              trace: [],
            },
          },
        }),
      ) ?? [];

    expect(metrics.find((item) => item.key === 'field_building')?.value).toBe(1);
    expect(metrics.find((item) => item.key === 'field_cabinet')?.value).toBe(0);
    expect(metrics.find((item) => item.key === 'field_equipment')?.value).toBe(1);
    expect(metrics.find((item) => item.key === 'fields_accuracy')?.value).toBeCloseTo(2 / 3);
  });

  it('сравнивает точные поля без нормализации и возвращает пусто без эталона', () => {
    const exact = intakeStep?.evaluate?.(
      { fields: { category: 'Printer' } },
      draft({
        fields: {
          category: {
            key: 'category',
            value: 'printer',
            confidence: 0.9,
            quote: null,
            origin: 'text',
            needsReview: false,
            trace: [],
          },
        },
      }),
    );
    expect(exact?.[0]?.value).toBe(0);
    expect(intakeStep?.evaluate?.({}, draft())).toEqual([]);
  });
});
