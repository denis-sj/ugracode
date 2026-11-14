import { describe, expect, it } from 'vitest';
import { duration, formatPhone, pickCall, sourceLabel, statusText, type CallView } from '../web/format';

function call(patch: Partial<CallView>): CallView {
  return {
    id: 'c-1',
    from: '+79120001122',
    status: 'ended',
    startedAt: '2026-11-14T10:00:00.000Z',
    endedAt: '2026-11-14T10:01:05.000Z',
    emergency: false,
    ticketId: null,
    ticketNumber: null,
    lines: [],
    ...patch,
  };
}

describe('формат экрана звонков', () => {
  it('выбирает идущий звонок, иначе последний, а выбранный — всегда', () => {
    const ended = call({ id: 'old' });
    const active = call({ id: 'live', status: 'active', endedAt: null });
    expect(pickCall([ended, active], null)?.id).toBe('live');
    expect(pickCall([ended], null)?.id).toBe('old');
    expect(pickCall([ended, active], 'old')?.id).toBe('old');
    expect(pickCall([ended], 'missing')?.id).toBe('old');
    expect(pickCall([], null)).toBeNull();
  });

  it('считает длительность', () => {
    expect(duration(call({}), 0)).toBe('1:05');
    expect(duration(call({ endedAt: null }), Date.parse('2026-11-14T10:00:09.500Z'))).toBe('0:09');
  });

  it('форматирует номер', () => {
    expect(formatPhone('+79120001122')).toBe('+7 912 000-11-22');
    expect(formatPhone('89120001122')).toBe('+7 912 000-11-22');
    expect(formatPhone('anonymous')).toBe('номер скрыт');
    expect(formatPhone('')).toBe('номер скрыт');
    expect(formatPhone('112')).toBe('112');
  });

  it('подписывает источник реплики ИИ', () => {
    const at = '2026-11-14T10:00:00.000Z';
    expect(sourceLabel({ speaker: 'ai', text: 'x', at, source: 'ai', ms: 2140 })).toBe('ИИ · 2.1 с');
    expect(sourceLabel({ speaker: 'ai', text: 'x', at, source: 'fallback' })).toContain('запасная');
    expect(sourceLabel({ speaker: 'ai', text: 'x', at, source: 'rule' })).toContain('правило');
    expect(sourceLabel({ speaker: 'caller', text: 'x', at })).toBeNull();
  });

  it('статус звонка', () => {
    expect(statusText(call({ status: 'active' }))).toBe('Идёт разговор');
    expect(statusText(call({ ticketNumber: 'З-1' }))).toBe('Заявка З-1');
    expect(statusText(call({}))).toBe('Звонок завершён');
  });
});
