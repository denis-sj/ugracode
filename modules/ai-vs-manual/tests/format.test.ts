import { describe, expect, it } from 'vitest';
import type { FieldDef, TicketField } from '@ugra/contracts';
import {
  MAX_SESSIONS,
  aiFieldRows,
  demoSessions,
  dictionaryOptions,
  displayFieldValue,
  formatSeconds,
  parseSessions,
  pickMeasureFields,
  savingsPercent,
  speedup,
  summarizeSessions,
  tally,
  type MeasureSession,
} from '../web/format';

const NOW = Date.parse('2026-11-14T10:00:00.000Z');

function session(patch: Partial<MeasureSession> = {}): MeasureSession {
  return {
    id: 's-1',
    mode: 'manual',
    actions: 10,
    seconds: 20,
    fields: 6,
    createdAt: new Date(NOW).toISOString(),
    ...patch,
  };
}

function def(key: string, patch: Partial<FieldDef> = {}): FieldDef {
  return {
    key,
    label: key.toUpperCase(),
    group: 'location',
    type: 'string',
    required: false,
    extractHint: 'подсказка не показывается вручную',
    evalMode: 'normalized',
    ...patch,
  };
}

const DICTIONARIES = [
  { dictionary: 'building', code: 'Б', label: 'Корпус Б' },
  { dictionary: 'building', code: 'В', label: 'Корпус В' },
];

describe('summarizeSessions', () => {
  it('считает итог по демо-данным: 47 против 6 действий, 3 мин 34 с против 38 с', () => {
    const summary = summarizeSessions(demoSessions(NOW));
    expect(summary.ready).toBe(true);
    expect(summary.demo).toBe(true);
    expect(summary.manual.actions).toBe(47);
    expect(summary.ai.actions).toBe(6);
    expect(summary.actionsSaved).toBe(41);
    expect(summary.actionsPercent).toBe(87);
    expect(summary.manual.seconds).toBe(214);
    expect(summary.ai.seconds).toBe(38);
    expect(summary.secondsSaved).toBe(176);
    expect(summary.timePercent).toBe(82);
    expect(summary.speedup).toBe(7.8);
  });

  it('усредняет несколько сессий одного режима', () => {
    const summary = summarizeSessions([
      session({ id: 'm1', mode: 'manual', actions: 10, seconds: 10 }),
      session({ id: 'm2', mode: 'manual', actions: 20, seconds: 20 }),
      session({ id: 'a1', mode: 'ai', actions: 5, seconds: 5 }),
    ]);
    expect(summary.manual.sessions).toBe(2);
    expect(summary.manual.actions).toBe(15);
    expect(summary.manual.seconds).toBe(15);
    expect(summary.ai.actions).toBe(5);
    expect(summary.actionsSaved).toBe(10);
    expect(summary.actionsPercent).toBe(67);
    expect(summary.speedup).toBe(3);
  });

  it('честно показывает, что ИИ оказался дороже', () => {
    const summary = summarizeSessions([
      session({ mode: 'manual', actions: 5, seconds: 5 }),
      session({ id: 'a1', mode: 'ai', actions: 10, seconds: 5 }),
    ]);
    expect(summary.actionsSaved).toBe(-5);
    expect(summary.actionsPercent).toBe(-100);
    expect(summary.speedup).toBe(0.5);
  });

  it('на пустых данных даёт нули и ready: false', () => {
    const summary = summarizeSessions([]);
    expect(summary.ready).toBe(false);
    expect(summary.demo).toBe(false);
    expect(summary.manual.sessions).toBe(0);
    expect(summary.manual.actions).toBe(0);
    expect(summary.ai.seconds).toBe(0);
    expect(summary.actionsPercent).toBe(0);
    expect(summary.timePercent).toBe(0);
    expect(summary.speedup).toBe(0);
  });

  it('не падает на битых записях и не смешивает их с хорошими', () => {
    const broken = [
      session({ id: 'ok', mode: 'manual', actions: 12, seconds: 30 }),
      { id: 'bad', mode: 'manual', actions: Number.NaN, seconds: 10, fields: 1, createdAt: 'x' },
      { id: '', mode: 'manual', actions: 3, seconds: 3, fields: 1, createdAt: 'x' },
      null,
      'мусор',
    ];
    const summary = summarizeSessions(broken as unknown as MeasureSession[]);
    expect(summary.manual.sessions).toBe(1);
    expect(summary.manual.actions).toBe(12);
  });
});

describe('savingsPercent', () => {
  it('считает экономию от базы', () => {
    expect(savingsPercent(10, 4)).toBe(60);
    expect(savingsPercent(47, 6)).toBe(87);
    expect(savingsPercent(214, 38)).toBe(82);
  });

  it('возвращает ноль при нулевой базе и мусоре', () => {
    expect(savingsPercent(0, 0)).toBe(0);
    expect(savingsPercent(0, 5)).toBe(0);
    expect(savingsPercent(Number.NaN, 4)).toBe(0);
    expect(savingsPercent(10, Number.NaN)).toBe(0);
  });

  it('не приукрашивает: рост в два раза — минус 100 %', () => {
    expect(savingsPercent(10, 20)).toBe(-100);
    expect(savingsPercent(10, 30)).toBe(-100);
  });
});

describe('speedup', () => {
  it('считает, во сколько раз быстрее', () => {
    expect(speedup(47, 6)).toBe(7.8);
    expect(speedup(10, 5)).toBe(2);
  });

  it('без пары чисел даёт ноль', () => {
    expect(speedup(0, 5)).toBe(0);
    expect(speedup(10, 0)).toBe(0);
    expect(speedup(Number.NaN, 5)).toBe(0);
  });
});

describe('formatSeconds', () => {
  it('форматирует секунды и минуты', () => {
    expect(formatSeconds(0)).toBe('0 с');
    expect(formatSeconds(38)).toBe('38 с');
    expect(formatSeconds(42.4)).toBe('42 с');
    expect(formatSeconds(120)).toBe('2 мин');
    expect(formatSeconds(214)).toBe('3 мин 34 с');
    expect(formatSeconds(59.6)).toBe('1 мин');
  });

  it('отрицательное и мусор — ноль, а не «-1 с»', () => {
    expect(formatSeconds(-5)).toBe('0 с');
    expect(formatSeconds(Number.NaN)).toBe('0 с');
    expect(formatSeconds(Number.POSITIVE_INFINITY)).toBe('0 с');
  });
});

describe('parseSessions', () => {
  it('читает корректный JSON и массив', () => {
    const text = JSON.stringify([session()]);
    expect(parseSessions(text)).toHaveLength(1);
    expect(parseSessions([session()])).toHaveLength(1);
    expect(parseSessions(text)[0]?.mode).toBe('manual');
  });

  it('пустое и битое даёт пустой список без исключений', () => {
    expect(parseSessions('')).toEqual([]);
    expect(parseSessions('{oops')).toEqual([]);
    expect(parseSessions('{"a":1}')).toEqual([]);
    expect(parseSessions('null')).toEqual([]);
    expect(parseSessions(42)).toEqual([]);
    expect(parseSessions(undefined)).toEqual([]);
  });

  it('отбрасывает записи без режима, id, времени и с отрицательными числами', () => {
    const parsed = parseSessions([
      session(),
      { id: 'no-mode', actions: 1, seconds: 1, fields: 1, createdAt: 'x' },
      { id: '', mode: 'ai', actions: 1, seconds: 1, fields: 1, createdAt: 'x' },
      { id: 'neg', mode: 'ai', actions: -1, seconds: 1, fields: 1, createdAt: 'x' },
      { id: 'nan', mode: 'ai', actions: 1, seconds: Number.NaN, fields: 1, createdAt: 'x' },
      { id: 'no-date', mode: 'ai', actions: 1, seconds: 1, fields: 1, createdAt: '' },
    ]);
    expect(parsed.map((entry) => entry.id)).toEqual(['s-1']);
  });

  it('достраивает поля и приводит числа из строк', () => {
    const [entry] = parseSessions([
      { id: 'a', mode: 'ai', actions: '7', seconds: '3.5', createdAt: '2026-11-14T10:00:00.000Z' },
    ]);
    expect(entry?.actions).toBe(7);
    expect(entry?.seconds).toBe(3.5);
    expect(entry?.fields).toBe(0);
    expect(entry?.demo).toBe(false);
  });

  it('ограничивает историю MAX_SESSIONS', () => {
    const many = Array.from({ length: MAX_SESSIONS + 5 }, (_, index) => session({ id: `s-${index}` }));
    expect(parseSessions(many)).toHaveLength(MAX_SESSIONS);
  });
});

describe('tally', () => {
  it('считает суммы и средние по режимам', () => {
    const stats = tally([
      session({ id: 'm1', mode: 'manual', actions: 10, seconds: 30, fields: 6 }),
      session({ id: 'm2', mode: 'manual', actions: 20, seconds: 50, fields: 6 }),
      session({ id: 'a1', mode: 'ai', actions: 5, seconds: 10, fields: 4, demo: true }),
    ]);
    expect(stats.manual.totalActions).toBe(30);
    expect(stats.manual.totalSeconds).toBe(80);
    expect(stats.manual.actions).toBe(15);
    expect(stats.manual.seconds).toBe(40);
    expect(stats.manual.fields).toBe(6);
    expect(stats.ai.totalActions).toBe(5);
    expect(stats.ai.demo).toBe(true);
    expect(stats.manual.demo).toBe(false);
  });

  it('на пустом списке — нули', () => {
    const stats = tally([]);
    expect(stats.manual).toMatchObject({ sessions: 0, actions: 0, seconds: 0, fields: 0, demo: false });
    expect(stats.ai.sessions).toBe(0);
  });
});

describe('pickMeasureFields', () => {
  it('ставит обязательные первыми и режет до семи', () => {
    const defs = [
      def('object'),
      def('building', { required: true }),
      def('category', { required: { whenCategory: ['printer'] } }),
      def('cabinet', { required: true }),
      def('floor'),
      def('equipment'),
      def('symptom'),
      def('ip'),
    ];
    const picked = pickMeasureFields(defs);
    expect(picked).toHaveLength(7);
    expect(picked.slice(0, 3).map((field) => field.key)).toEqual(['building', 'category', 'cabinet']);
  });

  it('уважает лимит и пустой реестр', () => {
    const defs = [def('a'), def('b', { required: true }), def('c')];
    expect(pickMeasureFields(defs, 2).map((field) => field.key)).toEqual(['b', 'a']);
    expect(pickMeasureFields(defs, 0)).toEqual([]);
    expect(pickMeasureFields([])).toEqual([]);
  });
});

describe('displayFieldValue', () => {
  it('переводит код справочника в подпись', () => {
    const defs = [def('building', { type: 'dictionary', dictionary: 'building' }), def('object')];
    expect(displayFieldValue(defs, DICTIONARIES, 'building', 'Б')).toBe('Корпус Б');
    expect(displayFieldValue(defs, DICTIONARIES, 'building', 'X')).toBe('X');
    expect(displayFieldValue(defs, DICTIONARIES, 'object', 'принтер HP')).toBe('принтер HP');
  });

  it('пустое значение — null', () => {
    expect(displayFieldValue([], [], 'object', null)).toBeNull();
    expect(displayFieldValue([], [], 'object', undefined)).toBeNull();
    expect(displayFieldValue([], [], 'object', '   ')).toBeNull();
  });
});

describe('dictionaryOptions', () => {
  it('отдаёт варианты только для справочника', () => {
    const options = dictionaryOptions(
      def('building', { type: 'dictionary', dictionary: 'building' }),
      DICTIONARIES,
    );
    expect(options).toEqual([
      { code: 'Б', label: 'Корпус Б' },
      { code: 'В', label: 'Корпус В' },
    ]);
    expect(dictionaryOptions(def('object'), DICTIONARIES)).toEqual([]);
    expect(dictionaryOptions(null, DICTIONARIES)).toEqual([]);
  });
});

describe('aiFieldRows', () => {
  function ticketField(patch: Partial<TicketField> = {}): TicketField {
    return {
      ticketId: 't-1',
      fieldKey: 'object',
      value: 'принтер HP',
      confidence: 0.94,
      quote: { sourceId: 'appeal', text: 'принтер HP не печатает' },
      origin: 'text',
      needsReview: false,
      trace: [],
      aiValue: null,
      ...patch,
    };
  }

  it('идёт в порядке реестра и переводит справочники', () => {
    const defs = [
      def('object'),
      def('building', { type: 'dictionary', dictionary: 'building' }),
      def('cabinet'),
    ];
    const rows = aiFieldRows(defs, DICTIONARIES, [
      ticketField({ fieldKey: 'building', value: 'Б', confidence: 0.8, origin: 'cmdb', needsReview: true, quote: null }),
      ticketField(),
    ]);
    expect(rows.map((row) => row.key)).toEqual(['object', 'building']);
    expect(rows[0]).toMatchObject({ value: 'принтер HP', confidence: 0.94, quote: 'принтер HP не печатает' });
    expect(rows[1]).toMatchObject({
      value: 'Корпус Б',
      confidence: 0.8,
      origin: 'cmdb',
      needsReview: true,
      quote: null,
    });
  });

  it('пропускает поля без определения и соблюдает лимит', () => {
    const defs = [def('object'), def('cabinet')];
    const rows = aiFieldRows(defs, DICTIONARIES, [
      ticketField({ fieldKey: 'object' }),
      ticketField({ fieldKey: 'unknown' }),
      ticketField({ fieldKey: 'cabinet', value: '312' }),
    ]);
    expect(rows.map((row) => row.key)).toEqual(['object', 'cabinet']);
    expect(aiFieldRows(defs, DICTIONARIES, [ticketField()], 0)).toEqual([]);
    expect(aiFieldRows(defs, DICTIONARIES, [])).toEqual([]);
  });
});
