import { describe, expect, it } from 'vitest';
import type { FieldDef, Ticket, TicketField } from '@ugra/contracts';
import {
  emptyGroups,
  featuredEmergency,
  groupTickets,
  isReadyTicket,
  queueSize,
  unclearFieldLabels,
  unclearNote,
} from '../web/queue-groups';

function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 't-1',
    number: 'З-001',
    appealId: 'a-1',
    status: 'in_review',
    priority: 'medium',
    category: 'printer',
    departmentId: null,
    assigneeId: null,
    isEmergency: false,
    incidentId: null,
    reactDueAt: null,
    slaDueAt: null,
    equipmentId: null,
    locationId: null,
    confirmedBy: null,
    confirmedAt: null,
    createdAt: '2026-11-14T09:00:00.000Z',
    updatedAt: '2026-11-14T09:00:00.000Z',
    ...overrides,
  };
}

function field(fieldKey: string, needsReview: boolean): TicketField {
  return {
    ticketId: 't-1',
    fieldKey,
    value: 'значение',
    confidence: needsReview ? 0.4 : 0.9,
    quote: null,
    origin: 'text',
    needsReview,
    trace: [],
    aiValue: 'значение',
  };
}

function def(key: string, label: string): FieldDef {
  return {
    key,
    label,
    group: 'classification',
    type: 'string',
    required: false,
    extractHint: '',
    evalMode: 'none',
  };
}

const CONFIDENT = { review: 0, confidence: 0.88 };

describe('очередь: смысловые группы', () => {
  it('раскладывает статусы по группам, сохраняя порядок', () => {
    const tickets = [
      ticket({ id: 'decision', status: 'in_review' }),
      ticket({ id: 'ready', status: 'in_review' }),
      ticket({ id: 'engineer', status: 'assigned' }),
      ticket({ id: 'work', status: 'in_progress' }),
      ticket({ id: 'wait', status: 'waiting_applicant' }),
      ticket({ id: 'new', status: 'new' }),
      ticket({ id: 'draft', status: 'ai_draft' }),
    ];
    const groups = groupTickets(tickets, {
      decision: { review: 2, confidence: 0.5 },
      ready: CONFIDENT,
    });

    expect(groups.decision.map((item) => item.id)).toEqual(['decision']);
    expect(groups.ready.map((item) => item.id)).toEqual(['ready']);
    expect(groups.withEngineer.map((item) => item.id)).toEqual(['engineer', 'work']);
    expect(groups.waitingApplicant.map((item) => item.id)).toEqual(['wait']);
    expect(groups.drafting.map((item) => item.id)).toEqual(['new', 'draft']);
  });

  it('без сигналов и с сомнением заявка идёт в решение, уверенная — в готовые', () => {
    const groups = groupTickets(
      [
        ticket({ id: 'unknown' }),
        ticket({ id: 'low', isEmergency: false }),
        ticket({ id: 'sure' }),
        ticket({ id: 'review', isEmergency: false }),
      ],
      {
        low: { review: 0, confidence: 0.5 },
        sure: CONFIDENT,
        review: { review: 1, confidence: 0.95 },
      },
    );

    expect(groups.decision.map((item) => item.id)).toEqual(['unknown', 'low', 'review']);
    expect(groups.ready.map((item) => item.id)).toEqual(['sure']);
  });

  it('авария не попадает в «готовы к подтверждению» даже при высокой уверенности', () => {
    expect(isReadyTicket(ticket({ isEmergency: true }), CONFIDENT)).toBe(false);
    expect(isReadyTicket(ticket({ status: 'assigned' }), CONFIDENT)).toBe(false);
    expect(isReadyTicket(ticket(), CONFIDENT)).toBe(true);
    expect(isReadyTicket(ticket(), undefined)).toBe(false);
  });

  it('пустая очередь — пустые группы и нулевой размер', () => {
    const groups = groupTickets([], {});
    expect(groups).toEqual(emptyGroups());
    expect(queueSize(groups)).toBe(0);
  });

  it('размер — сумма всех групп', () => {
    expect(
      queueSize({
        decision: [ticket()],
        ready: [ticket(), ticket()],
        withEngineer: [ticket()],
        waitingApplicant: [],
        drafting: [ticket()],
      }),
    ).toBe(5);
  });
});

describe('очередь: закреплённая авария', () => {
  it('берёт первую активную аварию в порядке очереди', () => {
    const first = ticket({ id: 'first', isEmergency: true, status: 'in_review' });
    const second = ticket({ id: 'second', isEmergency: true, status: 'assigned' });
    expect(featuredEmergency([first, second])?.id).toBe('first');
  });

  it('закрытые и решённые аварии не держим на экране', () => {
    expect(
      featuredEmergency([
        ticket({ isEmergency: true, status: 'closed' }),
        ticket({ isEmergency: true, status: 'resolved' }),
        ticket({ isEmergency: true, status: 'cancelled' }),
      ]),
    ).toBeNull();
    expect(featuredEmergency([ticket({ isEmergency: false })])).toBeNull();
  });

  it('без активных аварий — null', () => {
    expect(featuredEmergency([])).toBeNull();
  });
});

describe('очередь: почему нужно решение', () => {
  const defs = [def('category', 'Категория'), def('urgency', 'Срочность'), def('symptoms', 'Симптомы')];

  it('берёт только спорные поля и переводит подписи в строчные', () => {
    const fields = [field('category', true), field('urgency', true), field('symptoms', false)];
    expect(unclearFieldLabels(fields, defs)).toEqual(['категория', 'срочность']);
  });

  it('ограничивает число подписей и пропускает поля без описания', () => {
    const fields = [field('unknown', true), field('category', true), field('urgency', true)];
    expect(unclearFieldLabels(fields, defs, 1)).toEqual(['категория']);
  });

  it('собирает одну строку причины или null', () => {
    expect(unclearNote([field('urgency', true)], defs)).toBe('Не ясно: срочность');
    expect(unclearNote([], defs)).toBeNull();
    expect(unclearNote(null, defs)).toBeNull();
    expect(unclearNote([field('unknown', true)], defs)).toBeNull();
  });
});
