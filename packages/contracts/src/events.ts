import { z } from 'zod';

/** События ядра. События модулей — с префиксом id модуля и своей схемой. */
export const CoreEventType = z.enum([
  'appeal.created',
  'analysis.started',
  'analysis.step.completed',
  'analysis.completed',
  'ticket.field.set',
  'ticket.field.corrected',
  'ticket.confirmed',
  'ticket.assigned',
  'ticket.status.changed',
  'message.sent',
  'setting.changed',
]);
export type CoreEventType = z.infer<typeof CoreEventType>;

export const EventType = z.union([CoreEventType, z.string()]);
export type EventType = z.infer<typeof EventType>;

export const Actor = z.object({
  kind: z.enum(['user', 'ai', 'system']),
  id: z.string().optional(),
});
export type Actor = z.infer<typeof Actor>;

export const DomainEvent = z.object({
  id: z.string(),
  type: z.string(),
  at: z.string(),
  actor: Actor,
  ticketId: z.string().optional(),
  payload: z.unknown(),
});
export type DomainEvent = z.infer<typeof DomainEvent>;

export type NewEvent = Omit<DomainEvent, 'id' | 'at'> & { id?: string; at?: string };

export type EventHandler = (event: DomainEvent) => void | Promise<void>;

export const EventDef = z.object({
  type: z.string(),
  description: z.string(),
});
export type EventDef = z.infer<typeof EventDef>;

/** Шина событий: сначала запись в журнал, затем рассылка подписчикам. */
export interface EventBus {
  publish(event: NewEvent): Promise<void>;
  subscribe(type: string | '*', handler: EventHandler): () => void;
}
