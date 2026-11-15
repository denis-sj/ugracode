import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FieldsFile } from '@ugra/contracts';
import type { AnalysisDraft, Appeal, FieldValue, User } from '@ugra/contracts';
import type {
  ApplicantProfile,
  CmdbPort,
  Equipment,
  EquipmentQuery,
  ReferenceData,
  StepContext,
  StepProgress,
} from '@ugra/core';
import { MemoryStore, createReferenceData } from '@ugra/core';
import applicantProfile from '../server';
import { equipmentTypeInText } from '../server/prefill';

const root = process.cwd();
const fields = FieldsFile.parse(JSON.parse(readFileSync(join(root, 'data/fields.json'), 'utf8'))).fields;
const cmdbFile = JSON.parse(readFileSync(join(root, 'data/cmdb.json'), 'utf8')) as {
  equipment: Equipment[];
};

const now = new Date('2026-11-14T10:00:00.000Z');
const applicantId = 'u-applicant-14';

const appeal: Appeal = {
  id: 'appeal-1',
  channel: 'chat',
  authorId: applicantId,
  originalText: 'Принтер не печатает, мигает красный индикатор.',
  attachments: [],
  createdAt: now.toISOString(),
};

const user: User = {
  id: applicantId,
  fullName: 'Людмила Комарова',
  role: 'applicant',
  departmentId: 'dep-accounting',
  position: 'Бухгалтер по расчётам',
};

/** Заявитель из каб. 312 корпуса Б — тот же профиль, что в `data/users.json`. */
function profileOf(): ApplicantProfile {
  return {
    userId: applicantId,
    building: 'Б',
    floor: '3',
    cabinet: '312',
    equipmentId: 'eq-b312-pc1',
    updatedAt: now.toISOString(),
  };
}

function queryMatch(value: string | null, query: string | undefined): boolean {
  return query === undefined || (value !== null && value.toLowerCase().includes(query.toLowerCase()));
}

function cmdbOf(equipment: readonly Equipment[] = cmdbFile.equipment): CmdbPort {
  return {
    async findEquipment(query: EquipmentQuery) {
      return equipment.filter(
        (item) =>
          queryMatch(item.building, query.building) &&
          queryMatch(item.cabinet, query.cabinet) &&
          queryMatch(item.type, query.type),
      );
    },
    async locations() {
      return [];
    },
  };
}

function data(): ReferenceData {
  return createReferenceData({ fields });
}

function draft(patch: Partial<AnalysisDraft> = {}): AnalysisDraft {
  return {
    sources: [{ id: appeal.id, kind: 'text', text: appeal.originalText }],
    fields: {},
    missing: [],
    ext: {},
    ...patch,
  };
}

function textField(key: string, value: string): FieldValue {
  return {
    key,
    value,
    confidence: 0.9,
    quote: { sourceId: appeal.id, text: value },
    origin: 'text',
    needsReview: false,
    trace: [{ kind: 'found', step: 'agent.intake', at: now.toISOString() }],
  };
}

interface ContextOptions {
  draft?: AnalysisDraft;
  profile?: ApplicantProfile | null;
  user?: User;
  withUser?: boolean;
  cmdb?: CmdbPort;
  onProgress?: (progress: StepProgress) => void;
}

async function context(options: ContextOptions = {}): Promise<StepContext> {
  const store = new MemoryStore();
  const currentUser = options.user ?? user;
  if (options.withUser !== false) {
    await store.saveUser(currentUser);
    const profile = options.profile === undefined ? profileOf() : options.profile;
    if (profile) await store.saveApplicantProfile(profile);
  }
  return {
    runId: 'run-1',
    appeal,
    user: options.withUser === false ? undefined : currentUser,
    db: store,
    draft: options.draft ?? draft(),
    ports: {
      llm: { structured: async () => Promise.reject(new Error('llm не нужен')), chat: async () => Promise.reject(new Error('llm не нужен')) },
      embeddings: { embed: async () => Promise.reject(new Error('embeddings не нужны')) },
      speech: { transcribe: async () => Promise.reject(new Error('speech не нужен')) },
      vision: { describe: async () => Promise.reject(new Error('vision не нужен')) },
      cmdb: options.cmdb ?? cmdbOf(),
      history: { similar: async () => [] },
      notifications: { send: async () => ({ delivered: true }) },
      tts: { available: false, speak: () => Promise.reject(new Error('tts не нужен')) },
      clock: { now: () => now },
    },
    data: data(),
    progress: options.onProgress ?? (() => undefined),
    trace: () => undefined,
    signal: new AbortController().signal,
  };
}

const step = applicantProfile.steps[0]!;

async function run(options: ContextOptions = {}): Promise<Record<string, FieldValue>> {
  const patch = await step.run(await context(options));
  return patch?.fields ?? {};
}

describe('модуль applicant-profile: шаг profile.prefill', () => {
  it('заполняет пустые поля места и единственную технику названного типа', async () => {
    const result = await run();

    expect(result.building).toMatchObject({ key: 'building', value: 'Б', origin: 'profile', confidence: 0.8 });
    expect(result.floor?.value).toBe('3');
    expect(result.cabinet?.value).toBe('312');
    expect(result.equipment?.value).toBe('HP LaserJet Pro M404dn');
    expect(result.model?.value).toBe('HP LaserJet Pro M404dn');
    expect(result.inventoryNo?.value).toBe('INV-000312');
    expect(result.ip?.value).toBe('10.10.3.12');
  });

  it('оставляет след from_profile без цитаты у каждого подставленного поля', async () => {
    const result = await run();

    for (const field of Object.values(result)) {
      expect(field.quote).toBeNull();
      expect(field.needsReview).toBe(false);
      expect(field.trace).toEqual([
        { kind: 'from_profile', step: 'profile.prefill', at: now.toISOString() },
      ]);
    }
  });

  it('не трогает поля, которые уже заполнены из текста, и ищет технику по месту из текста', async () => {
    const result = await run({
      draft: draft({ fields: { building: textField('building', 'А'), cabinet: textField('cabinet', '101') } }),
    });

    expect(result.building).toBeUndefined();
    expect(result.cabinet).toBeUndefined();
    expect(result.floor?.value).toBe('3');
    // Каб. 101 корпуса А — принтер Kyocera, а не HP из кабинета заявителя.
    expect(result.equipment?.value).toBe('Kyocera ECOSYS P2040dn');
  });

  it('не перезаписывает технику, названную в тексте', async () => {
    const result = await run({
      draft: draft({ fields: { equipment: textField('equipment', 'Kyocera ECOSYS P2040dn') } }),
    });

    expect(result.equipment).toBeUndefined();
    // Остальные характеристики однозначной единицы подставить можно: они про ту же технику.
    expect(result.model?.value).toBe('HP LaserJet Pro M404dn');
  });

  it('без названного типа техники подставляет только место', async () => {
    const sitesDraft = draft({
      sources: [{ id: appeal.id, kind: 'text', text: 'Не работает интернет в кабинете' }],
    });
    const result = await run({ draft: sitesDraft });

    expect(result.building?.value).toBe('Б');
    expect(result.equipment).toBeUndefined();
    expect(result.ip).toBeUndefined();
  });

  it('несколько единиц одного типа — технику не угадываем', async () => {
    const printer = cmdbFile.equipment.find((item) => item.id === 'eq-printer-b312');
    expect(printer).toBeDefined();
    const result = await run({
      cmdb: cmdbOf([printer!, { ...printer!, id: 'eq-printer-b312-2', inventoryNo: 'INV-000313' }]),
    });

    expect(result.building?.value).toBe('Б');
    expect(result.equipment).toBeUndefined();
  });

  it('недоступная CMDB не роняет шаг: место подставлено, техника — нет', async () => {
    const result = await run({
      cmdb: {
        findEquipment: async () => Promise.reject(new Error('CMDB недоступна')),
        locations: async () => [],
      },
    });

    expect(result.cabinet?.value).toBe('312');
    expect(result.equipment).toBeUndefined();
  });

  it('гость без пользователя — ничего не подставляет', async () => {
    expect(await run({ withUser: false })).toEqual({});
  });

  it('пользователь без профиля — ничего не подставляет', async () => {
    expect(await run({ profile: null })).toEqual({});
  });

  it('гость guest без профиля — ничего не подставляет', async () => {
    const guest: User = {
      id: 'guest',
      fullName: 'Гость',
      role: 'applicant',
      departmentId: null,
      position: 'Гость (без профиля)',
    };
    expect(await run({ user: guest, profile: null })).toEqual({});
  });

  it('сообщает о каждом подставленном поле', async () => {
    const reported: StepProgress[] = [];
    await run({ onProgress: (progress) => reported.push(progress) });

    const keys = reported.flatMap((progress) => progress.fields ?? []);
    expect(keys).toEqual(['building', 'floor', 'cabinet', 'equipment', 'model', 'inventoryNo', 'ip']);
    expect(reported.every((progress) => progress.stepId === 'profile.prefill')).toBe(true);
    expect(reported[0]?.message).toContain('Корпус');
  });
});

describe('equipmentTypeInText', () => {
  it('узнаёт типы техники по словам заявителя', () => {
    expect(equipmentTypeInText('принтер не печатает')).toBe('printer');
    expect(equipmentTypeInText('ПК не включается')).toBe('pc');
    expect(equipmentTypeInText('комп не включается')).toBe('pc');
    expect(equipmentTypeInText('компьютер завис')).toBe('pc');
    expect(equipmentTypeInText('замятие в МФУ')).toBe('mfu');
    expect(equipmentTypeInText('не работает свитч')).toBe('network');
    expect(equipmentTypeInText('сервер недоступен')).toBe('server');
  });

  it('не находит тип в обычном тексте', () => {
    expect(equipmentTypeInText('нет доступа к интернету')).toBeNull();
    expect(equipmentTypeInText('ничего не работает')).toBeNull();
  });
});
