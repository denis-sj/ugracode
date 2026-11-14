import type { FieldDef, User } from '@ugra/contracts';
import { MemoryStore, createReferenceData, type Ports, type ReferenceData } from '@ugra/core';

const fields: FieldDef[] = [
  {
    key: 'building',
    label: 'Корпус',
    group: 'location',
    type: 'dictionary',
    dictionary: 'building',
    required: true,
    extractHint: 'буква корпуса',
    ask: { question: 'В каком корпусе?', widget: 'select', optionsFrom: 'building' },
    evalMode: 'exact',
  },
  {
    key: 'cabinet',
    label: 'Кабинет',
    group: 'location',
    type: 'string',
    required: true,
    extractHint: 'номер кабинета',
    pattern: '^[0-9]{1,4}$',
    ask: { question: 'Номер кабинета?', widget: 'text' },
    evalMode: 'exact',
  },
  {
    key: 'equipment',
    label: 'Оборудование',
    group: 'equipment',
    type: 'string',
    required: true,
    extractHint: 'принтер, МФУ, ПК',
    evalMode: 'normalized',
  },
  {
    key: 'category',
    label: 'Категория',
    group: 'classification',
    type: 'dictionary',
    dictionary: 'category',
    required: true,
    extractHint: 'тип услуги',
    evalMode: 'exact',
  },
];

export function testReferenceData(): ReferenceData {
  return createReferenceData({
    fields,
    dictionaries: [
      { dictionary: 'building', code: 'А', label: 'Корпус А' },
      { dictionary: 'building', code: 'Б', label: 'Корпус Б' },
      { dictionary: 'category', code: 'printer', label: 'Принтеры' },
    ],
    settings: { confidenceThreshold: 0.75 },
  });
}

export function testPorts(): Ports {
  const notConfigured = (name: string) => async (): Promise<never> => {
    throw new Error(`порт не настроен: ${name}`);
  };
  return {
    llm: { structured: notConfigured('llm') },
    embeddings: { embed: notConfigured('embeddings') },
    speech: { transcribe: notConfigured('speech') },
    vision: { describe: notConfigured('vision') },
    cmdb: { findEquipment: async () => [], locations: async () => [] },
    history: { similar: async () => [] },
    notifications: { send: async () => ({ delivered: true }) },
    clock: { now: () => new Date('2026-11-14T10:00:00.000Z') },
  };
}

export async function seedUsers(
  store: MemoryStore,
): Promise<{ applicant: User; dispatcher: User; engineer: User; manager: User }> {
  const applicant: User = {
    id: 'u-applicant-1',
    fullName: 'Денис Соколов',
    role: 'applicant',
    departmentId: 'dep-it',
    position: 'Инженер',
  };
  const dispatcher: User = {
    id: 'u-dispatcher-1',
    fullName: 'Анна Миронова',
    role: 'dispatcher',
    departmentId: 'dep-dispatch',
    position: 'Диспетчер',
  };
  const engineer: User = {
    id: 'u-engineer-1',
    fullName: 'Игорь Лебедев',
    role: 'engineer',
    departmentId: 'dep-it',
    position: 'Инженер поддержки',
  };
  const manager: User = {
    id: 'u-manager-1',
    fullName: 'Ольга Ветрова',
    role: 'manager',
    departmentId: 'dep-it',
    position: 'Руководитель ИТ-службы',
  };
  await store.saveUser(applicant);
  await store.saveUser(dispatcher);
  await store.saveUser(engineer);
  await store.saveUser(manager);
  return { applicant, dispatcher, engineer, manager };
}

export const PRINTER_TEXT =
  'Корпус Б, кабинет 312, принтер HP не печатает, мигает красный индикатор';
