import { describe, expect, it } from 'vitest';
import type { DomainEvent, User } from '@ugra/contracts';
import { canSeeEvent } from '../src/event-access';

const event: DomainEvent = {
  id: 'e-1',
  type: 'ticket.status.changed',
  at: '2026-11-14T10:00:00.000Z',
  actor: { kind: 'system' },
  ticketId: 't-1',
  payload: {},
};

function user(role: User['role'], id = 'u-1'): User {
  return { id, fullName: 'Тест', role, departmentId: null, position: 'Тест' };
}

const ticket = { ticketId: 't-1', assignedTo: 'u-engineer-1', authorId: 'u-applicant-1' };

describe('canSeeEvent', () => {
  it('диспетчер и руководитель видят всё', () => {
    expect(canSeeEvent(user('dispatcher'), event, ticket)).toBe(true);
    expect(canSeeEvent(user('manager'), event, ticket)).toBe(true);
    expect(canSeeEvent(user('admin'), event, ticket)).toBe(true);
  });

  it('заявитель видит только свои обращения', () => {
    expect(canSeeEvent(user('applicant', 'u-applicant-1'), event, ticket)).toBe(true);
    expect(canSeeEvent(user('applicant', 'u-other'), event, ticket)).toBe(false);
  });

  it('инженер видит назначенные ему заявки', () => {
    expect(canSeeEvent(user('engineer', 'u-engineer-1'), event, ticket)).toBe(true);
    expect(canSeeEvent(user('engineer', 'u-engineer-2'), event, ticket)).toBe(false);
  });

  it('событие без заявки видят все, кроме заявителя', () => {
    const global = { ...event, ticketId: undefined };
    expect(canSeeEvent(user('dispatcher'), global, null)).toBe(true);
    expect(canSeeEvent(user('engineer'), global, null)).toBe(true);
    expect(canSeeEvent(user('applicant'), global, null)).toBe(true);
  });

  it('заявителю не отдаём событие по неизвестной заявке', () => {
    expect(canSeeEvent(user('applicant', 'u-applicant-1'), event, null)).toBe(false);
  });
});
