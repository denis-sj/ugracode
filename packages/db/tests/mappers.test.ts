import { describe, expect, it } from 'vitest';
import type { EventLogRow, TicketFieldRow, TicketRow } from '../src/schema';
import { mapEventLogRow, mapTicketFieldRow, mapTicketRow, toIso, toIsoOrNull } from '../src/mappers';

const ticketRow: TicketRow = {
  id: 't-1',
  number: 'З-20261114-0001',
  appealId: 'a-1',
  status: 'ai_draft',
  priority: null,
  category: 'printer',
  departmentId: 'dep-2',
  assigneeId: null,
  isEmergency: false,
  incidentId: null,
  reactDueAt: null,
  slaDueAt: null,
  equipmentId: null,
  locationId: null,
  confirmedBy: null,
  confirmedAt: null,
  createdAt: '2026-11-14T10:00:00.000Z',
  updatedAt: '2026-11-14T10:05:00.000Z',
};

describe('mapTicketRow', () => {
  it('переносит все колонки в доменную заявку', () => {
    expect(mapTicketRow(ticketRow)).toEqual({
      id: 't-1',
      number: 'З-20261114-0001',
      appealId: 'a-1',
      status: 'ai_draft',
      priority: null,
      category: 'printer',
      departmentId: 'dep-2',
      assigneeId: null,
      isEmergency: false,
      incidentId: null,
      reactDueAt: null,
      slaDueAt: null,
      equipmentId: null,
      locationId: null,
      confirmedBy: null,
      confirmedAt: null,
      createdAt: '2026-11-14T10:00:00.000Z',
      updatedAt: '2026-11-14T10:05:00.000Z',
    });
  });

  it('нормализует даты, если драйвер вернул Date', () => {
    const withDates: TicketRow = {
      ...ticketRow,
      slaDueAt: new Date('2026-11-15T09:00:00.000Z') as unknown as string,
    };
    expect(mapTicketRow(withDates).slaDueAt).toBe('2026-11-15T09:00:00.000Z');
  });
});

describe('mapTicketFieldRow', () => {
  it('сохраняет числовое значение и след', () => {
    const row: TicketFieldRow = {
      ticketId: 't-1',
      fieldKey: 'cabinet',
      value: 312,
      confidence: 0.9,
      quote: { sourceId: 'a-1', text: 'кабинет 312' },
      origin: 'text',
      needsReview: false,
      trace: [{ kind: 'found', step: 'extract', at: '2026-11-14T10:00:00.000Z' }],
      aiValue: 312,
    };
    expect(mapTicketFieldRow(row)).toEqual({
      ticketId: 't-1',
      fieldKey: 'cabinet',
      value: 312,
      confidence: 0.9,
      quote: { sourceId: 'a-1', text: 'кабинет 312' },
      origin: 'text',
      needsReview: false,
      trace: [{ kind: 'found', step: 'extract', at: '2026-11-14T10:00:00.000Z' }],
      aiValue: 312,
    });
  });
});

describe('mapEventLogRow', () => {
  it('разворачивает актора и пропускает пустые ссылки', () => {
    const row: EventLogRow = {
      id: 'e-1',
      type: 'ticket.created',
      at: '2026-11-14T10:00:00.000Z',
      actorKind: 'system',
      actorId: null,
      ticketId: 't-1',
      payload: { ok: true },
    };
    expect(mapEventLogRow(row)).toEqual({
      id: 'e-1',
      type: 'ticket.created',
      at: '2026-11-14T10:00:00.000Z',
      actor: { kind: 'system', id: undefined },
      ticketId: 't-1',
      payload: { ok: true },
    });
  });
});

describe('toIso', () => {
  it('пропускает строку как есть', () => {
    expect(toIso('2026-11-14T10:00:00.000Z')).toBe('2026-11-14T10:00:00.000Z');
  });

  it('конвертирует Date', () => {
    expect(toIso(new Date('2026-11-14T10:00:00.000Z'))).toBe('2026-11-14T10:00:00.000Z');
  });

  it('падает на неожидаемом значении', () => {
    expect(() => toIso(42)).toThrow('Ожидалась дата');
  });

  it('возвращает null для пустого значения', () => {
    expect(toIsoOrNull(null)).toBeNull();
    expect(toIsoOrNull(undefined)).toBeNull();
  });
});

describe('toIso: формат PostgreSQL', () => {
  it('превращает timestamp с пробелом и смещением в ISO', () => {
    expect(toIso('2026-11-14 10:55:44.399+00')).toBe('2026-11-14T10:55:44.399Z');
  });

  it('оставляет корректную ISO-строку', () => {
    expect(toIso('2026-11-14T10:55:44.399Z')).toBe('2026-11-14T10:55:44.399Z');
  });

  it('возвращает исходное значение, если дата не разобрана', () => {
    expect(toIso('не дата')).toBe('не дата');
  });
});
