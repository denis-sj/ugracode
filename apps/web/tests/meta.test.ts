import { describe, expect, it } from 'vitest';
import type { FieldDef, MetaResponse } from '@ugra/contracts';
import { describeMeta } from '../src/meta';

const field = (key: string): FieldDef => ({
  key,
  label: key,
  group: 'symptoms',
  type: 'string',
  required: false,
  extractHint: 'из текста заявки',
  evalMode: 'none',
});

describe('describeMeta', () => {
  it('форматирует модули, режим и поля', () => {
    const meta: MetaResponse = {
      modules: [
        { id: 'gas', title: 'Газ' },
        { id: 'water', title: 'Вода' },
      ],
      fields: [field('address'), field('pressure'), field('equipment')],
      dictionaries: [],
      aiMode: 'cloud',
      roles: ['dispatcher'],
      priorities: ['medium'],
    };

    expect(describeMeta(meta)).toBe('Модулей: 2, режим: cloud, полей: 3');
  });

  it('работает на пустом ответе', () => {
    const meta: MetaResponse = {
      modules: [],
      fields: [],
      dictionaries: [],
      aiMode: 'stub',
      roles: [],
      priorities: [],
    };

    expect(describeMeta(meta)).toBe('Модулей: 0, режим: stub, полей: 0');
  });
});
