import { describe, expect, it } from 'vitest';
import {
  FieldDef,
  FieldValue,
  PriorityLevel,
  Role,
  Ticket,
  TRANSITIONS,
  buildAiExtractionSchema,
  findTransition,
  hasPermission,
  toJsonSchema,
} from '../src';

const printer: FieldDef = FieldDef.parse({
  key: 'equipment',
  label: 'Оборудование',
  group: 'equipment',
  type: 'string',
  required: true,
  extractHint: 'принтер, МФУ, ПК',
  evalMode: 'normalized',
});

const coreAspects = {
  emergency: { suspected: false, signs: [], confidence: 0.1 },
  sentiment: { label: 'neutral' as const, quote: null },
  summary: { text: 'Заявка о принтере' },
};

describe('FieldValue', () => {
  it('принимает значение с цитатой и следом', () => {
    const value = FieldValue.parse({
      key: 'equipment',
      value: 'принтер HP',
      confidence: 0.9,
      quote: { sourceId: 'appeal', text: 'принтер HP' },
      origin: 'text',
      needsReview: false,
      trace: [{ kind: 'found', step: 'extraction.fields', at: '2026-11-14T10:00:00.000Z' }],
    });
    expect(value.value).toBe('принтер HP');
    expect(value.trace).toHaveLength(1);
  });

  it('отклоняет уверенность вне диапазона', () => {
    expect(() =>
      FieldValue.parse({
        key: 'equipment',
        value: 'принтер',
        confidence: 1.5,
        quote: null,
        origin: 'text',
        needsReview: false,
      }),
    ).toThrow();
  });
});

describe('buildAiExtractionSchema', () => {
  it('строит enum ключей из реестра полей', () => {
    const schema = buildAiExtractionSchema([printer]);
    const ok = schema.safeParse({
      fields: [{ key: 'equipment', value: 'принтер', quote: 'принтер', confidence: 0.8 }],
      aspects: coreAspects,
    });
    expect(ok.success).toBe(true);
    const bad = schema.safeParse({
      fields: [{ key: 'unknown', value: 'x', quote: 'x', confidence: 0.5 }],
      aspects: coreAspects,
    });
    expect(bad.success).toBe(false);
  });

  it('работает с пустым реестром', () => {
    const schema = buildAiExtractionSchema([]);
    expect(schema.safeParse({ fields: [], aspects: coreAspects }).success).toBe(true);
  });

  it('отдаёт JSON Schema для response_format', () => {
    const json = toJsonSchema(buildAiExtractionSchema([printer]));
    expect(json.type).toBe('object');
    expect(JSON.stringify(json)).toContain('equipment');
  });
});

describe('статусы и права', () => {
  it('находит разрешённый переход', () => {
    expect(findTransition('in_review', 'assigned')?.permission).toBe('tickets.confirm');
  });

  it('не находит запрещённый переход', () => {
    expect(findTransition('new', 'closed')).toBeUndefined();
  });

  it('каждый переход объявляет роль и право', () => {
    for (const t of TRANSITIONS) {
      expect(t.roles.length).toBeGreaterThan(0);
      expect(t.permission).not.toBe('any');
    }
  });

  it('разрешает инженеру вернуть заявку диспетчеру', () => {
    const transition = findTransition('assigned', 'in_review');
    expect(transition?.roles).toContain('engineer');
    expect(findTransition('in_progress', 'in_review')?.roles).toContain('engineer');
  });

  it('знает пять уровней приоритета, включая emergency', () => {
    expect(PriorityLevel.safeParse('emergency').success).toBe(true);
    expect(PriorityLevel.options).toHaveLength(5);
  });

  it('проверяет права по роли', () => {
    expect(hasPermission('dispatcher', 'tickets.confirm')).toBe(true);
    expect(hasPermission('applicant', 'tickets.confirm')).toBe(false);
    expect(hasPermission(Role.enum.applicant, 'any')).toBe(true);
  });
});

describe('Ticket', () => {
  it('требует статус из таблицы', () => {
    const parsed = Ticket.safeParse({
      id: 't1',
      number: 'З-1',
      appealId: 'a1',
      status: 'in_review',
      priority: 'high',
      category: null,
      departmentId: null,
      assigneeId: null,
      isEmergency: false,
      incidentId: null,
      slaDueAt: null,
      confirmedBy: null,
      confirmedAt: null,
      createdAt: '2026-11-14T10:00:00.000Z',
      updatedAt: '2026-11-14T10:00:00.000Z',
    });
    expect(parsed.success).toBe(true);
    expect(Ticket.safeParse({ id: 't1', status: 'unknown' }).success).toBe(false);
  });
});
