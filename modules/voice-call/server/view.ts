import { z } from 'zod';
import type { CallRecord } from './calls';

/** Звонок для экрана диспетчера «Входящий звонок». */
export const CallView = z.object({
  id: z.string(),
  from: z.string(),
  status: z.enum(['active', 'ended']),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  emergency: z.boolean(),
  ticketId: z.string().nullable(),
  ticketNumber: z.string().nullable(),
  lines: z.array(
    z.object({
      speaker: z.enum(['caller', 'ai']),
      text: z.string(),
      at: z.string(),
      source: z.enum(['ai', 'fallback', 'rule']).optional(),
      ms: z.number().optional(),
    }),
  ),
});
export type CallView = z.infer<typeof CallView>;

export const CallsResponse = z.object({ calls: z.array(CallView) });
export const CallResponse = z.object({ call: CallView });

export function toView(call: CallRecord): CallView {
  return {
    id: call.id,
    from: call.from,
    status: call.status,
    startedAt: call.startedAt,
    endedAt: call.endedAt,
    emergency: call.emergency,
    ticketId: call.ticketId,
    ticketNumber: call.ticketNumber,
    lines: call.lines.map((line) => ({ ...line })),
  };
}

export const ActiveCallResponse = z.object({ call: CallView.nullable() });

export const PublicUrlResponse = z.object({
  url: z.string().nullable(),
  callUrl: z.string().nullable(),
  source: z.enum(['env', 'tunnel']).nullable(),
});
