import { describe, expect, it } from 'vitest';
import { THINKING_WORDS, humanizeLive, stepsLabel, titleOf } from '../../../modules/clarify-chat/web/RunTrace';
import type { RunProgressView } from '../../../modules/clarify-chat/web/format';

const base = { failed: false, finished: false, current: null, elapsedMs: 0, steps: [], trace: [] } as unknown as RunProgressView;

describe('строка «что делает ИИ»', () => {
  it('склоняет число шагов', () => {
    expect(stepsLabel(1)).toBe('1 шаг');
    expect(stepsLabel(3)).toBe('3 шага');
    expect(stepsLabel(5)).toBe('5 шагов');
    expect(stepsLabel(12)).toBe('12 шагов');
    expect(stepsLabel(22)).toBe('22 шага');
  });

  it('пока ИИ работает — «Думаю…», с текущим шагом — «Размышляю · шаг»', () => {
    expect(titleOf(base, true)).toBe(`${THINKING_WORDS[0]}…`);
    expect(titleOf({ ...base, current: 'Ищу технику в CMDB' }, true, 'Размышляю')).toBe('Размышляю · Ищу технику в CMDB');
  });

  it('ошибка и завершение', () => {
    expect(titleOf({ ...base, failed: true }, false)).toBe('Не удалось разобрать · показать ход');
    expect(titleOf({ ...base, finished: true, elapsedMs: 0 }, false)).toContain('ход работы');
  });

  it('имя инструмента агента — человеческими словами', () => {
    expect(humanizeLive('cmdb_find_equipment: CMDB: найдено 0 единиц(ы) техники')).toBe('ищу технику в CMDB');
    expect(humanizeLive('kb_search: База знаний: 1 статей')).toBe('ищу в базе знаний');
    expect(humanizeLive('new_tool: что-то')).toBe('работаю с данными');
    expect(humanizeLive('Проверяем цитаты')).toBe('Проверяем цитаты');
  });
});
