import { describe, expect, it } from 'vitest';
import type { FieldDef, MissingField } from '@ugra/contracts';
import { keepAsked, missingFields, requiredField } from '../src/core-steps';

const equipment: FieldDef = {
  key: 'equipment',
  label: 'Оборудование',
  group: 'equipment',
  type: 'cmdbRef',
  required: { whenCategory: ['printer', 'pc'] },
  extractHint: 'техника',
  ask: { question: 'Какое оборудование?', widget: 'select', optionsFrom: 'equipment' },
  evalMode: 'normalized',
};
const cabinet: FieldDef = {
  key: 'cabinet',
  label: 'Кабинет',
  group: 'location',
  type: 'string',
  required: true,
  extractHint: 'номер',
  evalMode: 'exact',
};
const floor: FieldDef = { ...cabinet, key: 'floor', label: 'Этаж', required: false };

function missing(key: string, question: string, source: MissingField['source'] = 'ai'): MissingField {
  return { key, label: key, question, widget: 'text', source, allowUnknown: true, allowFreeText: true };
}

describe('requiredField', () => {
  it('true и false — как есть', () => {
    expect(requiredField(cabinet)).toBe(true);
    expect(requiredField(floor)).toBe(false);
  });

  it('оборудование обязательно для принтера', () => {
    expect(requiredField(equipment, { category: { value: 'printer' } })).toBe(true);
  });

  it('оборудование не нужно для программы', () => {
    expect(requiredField(equipment, { category: { value: 'software' } })).toBe(false);
  });

  it('пока категория неизвестна, условное поле не требуем', () => {
    expect(requiredField(equipment, {})).toBe(false);
    expect(requiredField(equipment, { category: { value: null } })).toBe(false);
  });
});

describe('missingFields с условной обязательностью', () => {
  it('для 1С об оборудовании не спрашивает', () => {
    const keys = missingFields([cabinet, equipment], { category: { value: 'software' } }).map(
      (item) => item.key,
    );
    expect(keys).toEqual(['cabinet']);
  });

  it('для принтера спрашивает оборудование', () => {
    const keys = missingFields([cabinet, equipment], { category: { value: 'printer' } }).map(
      (item) => item.key,
    );
    expect(keys).toEqual(['cabinet', 'equipment']);
  });
});

describe('keepAsked', () => {
  it('сохраняет вопросы модели и их порядок, шаблоны добавляет в конец', () => {
    const asked = [missing('urgency', 'Работа встала?'), missing('cabinet', 'Где принтер?')];
    const computed = [missing('cabinet', 'Кабинет?', 'template'), missing('impact', 'Сколько?', 'template')];
    expect(keepAsked(asked, computed).map((item) => `${item.key}:${item.question}`)).toEqual([
      'urgency:Работа встала?',
      'cabinet:Где принтер?',
      'impact:Сколько?',
    ]);
  });

  it('убирает вопрос, если поле заполнили позже', () => {
    const asked = [missing('cabinet', 'Где принтер?')];
    expect(keepAsked(asked, [], { cabinet: { value: '312' } })).toEqual([]);
  });

  it('без вопросов модулей — шаблоны реестра', () => {
    const computed = [missing('cabinet', 'Кабинет?', 'template')];
    expect(keepAsked([], computed)).toEqual(computed);
  });
});
