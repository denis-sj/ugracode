import { describe, expect, it } from 'vitest';
import { sanitizeSummary, traceEventFromBus } from '../src/agent-trace';

describe('agent-trace: безопасный журнал', () => {
  it('прячет почты, UUID, инвентарные номера и телефоны', () => {
    const dirty =
      'нашёл принтер INV-000312, владелец ivan.petrov@example.com, id 123e4567-e89b-12d3-a456-426614174000, тел. 89123456789';
    const clean = sanitizeSummary(dirty);
    expect(clean).not.toContain('@');
    expect(clean).not.toContain('INV-000312');
    expect(clean).not.toContain('123e4567');
    expect(clean).not.toContain('89123456789');
  });

  it('убирает почту внутри фразы и оставляет обычные слова с «@» без домена', () => {
    expect(sanitizeSummary('Пишите на ivanov@corp.example.ru по вопросу')).toBe('Пишите на по вопросу');
    expect(sanitizeSummary('Канал @support в чате')).toBe('Канал @support в чате');
  });

  it('длинная строка без пробелов обрабатывается быстро', () => {
    const started = performance.now();
    sanitizeSummary(`${'a'.repeat(100_000)}@`);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('обрезает итог до 100 символов', () => {
    expect(sanitizeSummary('а'.repeat(300)).length).toBe(100);
  });

  it('превращает running в шаг журнала с человеческой подписью', () => {
    const event = traceEventFromBus(
      { phase: 'running', n: 1, tool: 'cmdb_find_equipment', appealId: 'a-1' },
      'run-1',
      'a-1',
    );
    expect(event).toMatchObject({
      type: 'agent.step',
      status: 'running',
      label: 'Ищу оборудование в базе',
      n: 1,
    });
    expect(JSON.stringify(event)).not.toContain('args');
  });

  it('done отдаёт короткий итог и время', () => {
    const event = traceEventFromBus(
      {
        phase: 'finished',
        step: { n: 2, tool: 'kb_search', resultSummary: 'База знаний: 2 статей', durationMs: 1200 },
      },
      'run-1',
      'a-1',
    );
    expect(event).toMatchObject({ status: 'done', durationMs: 1200, summary: 'База знаний: 2 статей' });
  });

  it('blocked и error нейтральны, без текста внутренней ошибки', () => {
    const blocked = traceEventFromBus(
      { phase: 'finished', step: { n: 3, tool: 'x', resultSummary: 'secret', blocked: true } },
      'run-1',
      'a-1',
    );
    expect(blocked?.status).toBe('blocked');
    expect(blocked?.summary).toBe('проверка пропущена');

    const failed = traceEventFromBus(
      { phase: 'finished', step: { n: 4, tool: 'x', resultSummary: 'secret', error: 'stack trace' } },
      'run-1',
      'a-1',
    );
    expect(failed?.status).toBe('error');
    expect(failed?.summary).toBe('не удалось выполнить');
  });

  it('битое событие не создаёт шаг', () => {
    expect(traceEventFromBus({}, 'run-1', 'a-1')).toBeNull();
    expect(traceEventFromBus({ phase: 'running' }, 'run-1', 'a-1')).toBeNull();
  });
});
