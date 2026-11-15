import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DictionariesFile, FieldsFile } from '@ugra/contracts';
import type { Appeal } from '@ugra/contracts';
import type { AgentContext, Equipment, EquipmentQuery } from '@ugra/core';
import { MemoryStore, createReferenceData } from '@ugra/core';
import { intakeQuestions, type IntakeResult } from '../contracts';
import { applicantState, checkIntake, intakeAgent } from '../server/intake';

const root = process.cwd();
const fields = FieldsFile.parse(JSON.parse(readFileSync(join(root, 'data/fields.json'), 'utf8'))).fields;
const dictionaries = DictionariesFile.parse(
  JSON.parse(readFileSync(join(root, 'data/dictionaries.json'), 'utf8')),
).items;

const appeal: Appeal = {
  id: 'a-1',
  channel: 'chat',
  authorId: 'u-1',
  originalText: 'В 312 принтер пишет «замятие», а бумаги нет',
  attachments: [],
  createdAt: '2026-11-14T10:00:00.000Z',
};

const printer: Equipment = {
  id: 'eq-printer-b312',
  type: 'printer',
  model: 'HP LaserJet Pro M404dn',
  serial: null,
  inventoryNo: 'INV-1',
  ip: null,
  building: 'Б',
  cabinet: '312',
  criticality: 'medium',
};

function context(
  options: { store?: MemoryStore; equipment?: Equipment[]; cmdbFails?: boolean } = {},
): AgentContext {
  return {
    user: {
      id: 'u-1',
      fullName: 'Денис Соколов',
      role: 'applicant',
      departmentId: null,
      position: 'Инженер',
    },
    appeal,
    ports: {
      clock: { now: () => new Date('2026-11-14T10:00:00.000Z') },
      cmdb: {
        async findEquipment(query: EquipmentQuery) {
          if (options.cmdbFails) throw new Error('CMDB недоступна');
          return (options.equipment ?? []).filter((item) => item.cabinet === query.cabinet);
        },
        async locations() {
          return [];
        },
      },
    } as unknown as AgentContext['ports'],
    data: createReferenceData({ fields, dictionaries, settings: {} }),
    db: options.store ?? new MemoryStore(),
    clock: { now: () => new Date('2026-11-14T10:00:00.000Z') },
  };
}

const base: IntakeResult = {
  fields: [{ key: 'cabinet', value: '312', quote: 'В 312', confidence: 0.9 }],
  emergency: { suspected: false, signs: [], confidence: 0.9 },
  summary: 'Принтер в 312 пишет замятие',
};

describe('вопросы модели: intakeQuestions', () => {
  it('берёт список questions в порядке модели и убирает повтор поля', () => {
    const result = intakeQuestions({
      questions: [
        { fieldKey: 'urgency', question: 'Работа встала?', options: [] },
        { fieldKey: 'impact', question: 'Только у вас?', options: [] },
        { fieldKey: 'urgency', question: 'Ещё раз про срочность', options: [] },
      ],
    });
    expect(result.map((item) => item.fieldKey)).toEqual(['urgency', 'impact']);
  });

  it('понимает старую форму с одним clarify', () => {
    const clarify = { fieldKey: 'impact', question: 'Только у вас?', options: [] };
    expect(intakeQuestions({ clarify })).toEqual([clarify]);
  });

  it('без вопросов возвращает пустой список', () => {
    expect(intakeQuestions({ clarify: null, questions: [] })).toEqual([]);
  });
});

describe('проверка вопросов модели', () => {
  it('не даёт спросить поле, которое модель уже заполнила из текста', () => {
    const problems = checkIntake(
      { ...base, questions: [{ fieldKey: 'cabinet', question: 'Какой кабинет?', options: [] }] },
      context(),
    );
    expect(problems.join(' ')).toMatch(/уже заполнено из текста/);
  });

  it('проверяет варианты справочника в каждом вопросе списка', () => {
    const problems = checkIntake(
      {
        ...base,
        questions: [
          { fieldKey: 'impact', question: 'Только у вас?', options: ['one'] },
          { fieldKey: 'urgency', question: 'Работа встала?', options: ['очень срочно'] },
        ],
      },
      context(),
    );
    expect(problems.join(' ')).toMatch(/«очень срочно» не из справочника urgency/);
    expect(problems.join(' ')).not.toMatch(/«one»/);
  });

  it('сообщает о вопросе по полю вне реестра', () => {
    const problems = checkIntake(
      { ...base, questions: [{ fieldKey: 'mood', question: 'Как настроение?', options: [] }] },
      context(),
    );
    expect(problems.join(' ')).toMatch(/по полю «mood», которого нет в реестре/);
  });

  it('хорошие вопросы проходят проверку', () => {
    const problems = checkIntake(
      { ...base, questions: [{ fieldKey: 'urgency', question: 'Работа встала?', options: ['down'] }] },
      context(),
    );
    expect(problems).toEqual([]);
  });
});

describe('состояние агента: заявитель', () => {
  it('без профиля отдаёт только ФИО и должность', async () => {
    await expect(applicantState(context())).resolves.toEqual({
      fullName: 'Денис Соколов',
      position: 'Инженер',
    });
  });

  it('с профилем отдаёт рабочее место и технику кабинета из CMDB', async () => {
    const store = new MemoryStore();
    await store.saveApplicantProfile({
      userId: 'u-1',
      building: 'Б',
      floor: '3',
      cabinet: '312',
      equipmentId: 'eq-printer-b312',
    });
    const state = await applicantState(context({ store, equipment: [printer] }));
    expect(state.workplace).toEqual({ building: 'Б', floor: '3', cabinet: '312' });
    expect(state.workplaceEquipment).toEqual([
      { type: 'printer', model: 'HP LaserJet Pro M404dn', main: true },
    ]);
  });

  it('CMDB недоступна — рабочее место всё равно есть, техники нет', async () => {
    const store = new MemoryStore();
    await store.saveApplicantProfile({
      userId: 'u-1',
      building: null,
      floor: null,
      cabinet: '312',
      equipmentId: null,
    });
    const state = await applicantState(context({ store, cmdbFails: true }));
    expect(state.workplace).toEqual({ building: null, floor: null, cabinet: '312' });
    expect(state.workplaceEquipment).toBeUndefined();
  });

  it('профиль без кабинета — CMDB не спрашиваем', async () => {
    const store = new MemoryStore();
    await store.saveApplicantProfile({
      userId: 'u-1',
      building: 'Б',
      floor: null,
      cabinet: null,
      equipmentId: null,
    });
    const state = await applicantState(context({ store, cmdbFails: true }));
    expect(state.workplaceEquipment).toBeUndefined();
  });

  it('хранилище упало — разбор не падает', async () => {
    const store = new MemoryStore();
    store.getApplicantProfile = async () => Promise.reject(new Error('БД недоступна'));
    await expect(applicantState(context({ store }))).resolves.toEqual({
      fullName: 'Денис Соколов',
      position: 'Инженер',
    });
  });

  it('агент кладёт заявителя в состояние', async () => {
    const state = await intakeAgent.state?.(context());
    expect(state).toMatchObject({ applicant: { fullName: 'Денис Соколов' } });
  });
});
