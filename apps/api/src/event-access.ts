import type { DomainEvent, User } from '@ugra/contracts';

export interface EventTicketInfo {
  ticketId: string | null;
  assignedTo: string | null;
  authorId: string | null;
}

/**
 * Кто видит событие в общем потоке: заявитель — только свои обращения,
 * инженер — назначенные ему и общие системные, диспетчер/руководитель/админ — всё.
 */
export function canSeeEvent(user: User, event: DomainEvent, ticket: EventTicketInfo | null): boolean {
  if (user.role !== 'applicant' && user.role !== 'engineer') return true;
  if (!event.ticketId) return true;
  if (!ticket) return false;
  if (user.role === 'applicant') return ticket.authorId === user.id;
  return ticket.assignedTo === user.id || ticket.authorId === user.id;
}
