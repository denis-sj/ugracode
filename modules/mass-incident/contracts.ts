import { PriorityLevel, Ticket } from '@ugra/contracts';
import { z } from 'zod';

/** Схемы модуля `mass-incident`: инцидент, его список и карточка с заявками. */

export const IncidentSchema = z.object({
  id: z.string(),
  number: z.string(),
  status: z.enum(['open', 'closed']),
  category: z.string().nullable(),
  building: z.string().nullable(),
  system: z.string().nullable(),
  size: z.number().int().nonnegative(),
  priority: PriorityLevel.nullable(),
  openedAt: z.string(),
  closedAt: z.string().nullable(),
});
export type IncidentDto = z.infer<typeof IncidentSchema>;

/** Строка списка: инцидент и сколько заявок к нему привязано. */
export const IncidentListItem = IncidentSchema.extend({
  ticketCount: z.number().int().nonnegative(),
});

export const IncidentsResponse = z.object({
  incidents: z.array(IncidentListItem),
});

export const IncidentDetailResponse = z.object({
  incident: IncidentSchema,
  tickets: z.array(Ticket),
});

/** Ответ демо-маршрута: сколько заявок создано и какой инцидент их склеил. */
export const DemoResponse = z.object({
  created: z.number().int().nonnegative(),
  incidentId: z.string().optional(),
});
