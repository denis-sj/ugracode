import { describe, expect, it } from 'vitest';
import type { MetaResponse } from '@ugra/contracts';
import { overviewQuery } from '../web/api';
import {
  buildFilterOptions,
  dictionaryOptions,
  EXPORT_DISABLED_HINT,
  EXPORT_ITEMS,
  mergeOptions,
  slicesToOptions,
} from '../web/options';

type Dictionaries = Pick<MetaResponse, 'dictionaries'>;

const meta: Dictionaries = {
  dictionaries: [
    { dictionary: 'category', code: 'printer', label: 'Принтер и печать' },
    { dictionary: 'category', code: 'network', label: 'Сеть и связь' },
    { dictionary: 'building', code: 'Б', label: 'Корпус Б' },
    { dictionary: 'channel', code: 'chat', label: 'Чат' },
    { dictionary: 'channel', code: 'phone', label: 'Телефон' },
  ],
};

describe('фильтры и выгрузка дашборда', () => {
  it('строит селекты из справочников meta и разреза ответа', () => {
    expect(dictionaryOptions(meta, 'category')).toEqual([
      { value: 'printer', label: 'Принтер и печать' },
      { value: 'network', label: 'Сеть и связь' },
    ]);
    expect(dictionaryOptions(null, 'category')).toEqual([]);

    const options = buildFilterOptions(meta, null, [
      { value: 'eng-1', label: 'Иван Петров' },
    ]);
    expect(options.categories).toHaveLength(2);
    expect(options.buildings).toEqual([{ value: 'Б', label: 'Корпус Б' }]);
    expect(options.channels).toHaveLength(2);
    expect(options.statuses.map((status) => status.value)).toContain('waiting_applicant');
    expect(options.assignees).toEqual([{ value: 'eng-1', label: 'Иван Петров' }]);
  });

  it('не теряет выбранного исполнителя, когда фильтр сузил разрез', () => {
    const merged = mergeOptions(
      [{ value: 'eng-1', label: 'Иван Петров' }],
      [{ value: 'eng-2', label: 'Мария Орлова' }],
    );
    expect(merged.map((option) => option.value)).toEqual(['eng-1', 'eng-2']);

    expect(slicesToOptions([{ key: 'printer', label: 'Принтер и печать', count: 3 }])).toEqual([
      { value: 'printer', label: 'Принтер и печать' },
    ]);
  });

  it('держит все пункты выгрузки выключенными с честной подсказкой', () => {
    expect(EXPORT_ITEMS.map((item) => item.label)).toEqual([
      'Excel (.xlsx)',
      'PDF-отчёт',
      'CSV',
      'Отправить на почту',
      'Присылать сводку',
    ]);
    expect(EXPORT_ITEMS.every((item) => item.disabled)).toBe(true);
    expect(EXPORT_ITEMS.every((item) => item.title.includes(EXPORT_DISABLED_HINT))).toBe(true);
  });

  it('собирает запрос: даты важнее пресета, конец включает весь день', () => {
    expect(overviewQuery(7, '', '', { category: 'printer' })).toEqual({
      category: 'printer',
      days: 7,
    });
    expect(overviewQuery(30, '2026-11-01', '2026-11-14', { status: 'closed' })).toEqual({
      status: 'closed',
      from: '2026-11-01T00:00:00',
      to: '2026-11-14T23:59:59',
    });
    expect(overviewQuery(30, '2026-11-14', '2026-11-01', {})).toEqual({ days: 30 });
    expect(overviewQuery(1, '2026-11-01', '', {})).toEqual({ days: 1 });
  });
});
