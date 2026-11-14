import { z } from 'zod';
import type { LlmPort } from '@ugra/core';
import type { CallLine, CallRecord, CallStore } from './calls';
import { dialogTurn } from './dialog';

/** Номер звонящего: цифры, плюс, скобки, пробелы и дефисы; `anonymous` — скрытый номер. */
const Phone = z
  .string()
  .trim()
  .max(32)
  .regex(/^(\+?[\d\s()-]{0,30}|anonymous)$/i, 'номер телефона');

export const TurnInput = z.object({
  callId: z.string().trim().min(1).max(128),
  from: Phone.default(''),
  /** Распознанная фраза заявителя; пустая — тишина или ASR не разобрал. */
  text: z.string().max(2000).default(''),
});
export type TurnInput = z.infer<typeof TurnInput>;

export const TurnResponse = z.object({
  say: z.string(),
  done: z.boolean(),
  emergency: z.boolean(),
  /** Номер реплики заявителя в звонке, с 1. */
  turn: z.number().int(),
});
export type TurnResponse = z.infer<typeof TurnResponse>;

export const EndInput = z.object({
  callId: z.string().trim().min(1).max(128),
  from: Phone.default(''),
  /** Расшифровка со стороны VoxEngine — запасной источник, если сервер перезапускался во время звонка. */
  transcript: z
    .array(z.object({ speaker: z.enum(['caller', 'ai']), text: z.string().max(2000) }))
    .max(20)
    .default([]),
});
export type EndInput = z.infer<typeof EndInput>;

export const EndResponse = z.object({
  ticketId: z.string().nullable(),
  ticketNumber: z.string().nullable(),
  /** Прощальная фраза для синтеза. */
  say: z.string(),
});
export type EndResponse = z.infer<typeof EndResponse>;

export interface CallAppeal {
  callId: string;
  from: string;
  /** Что сказал заявитель — текст обращения для разбора. */
  text: string;
  lines: readonly CallLine[];
  emergency: boolean;
}

/** Куда уходит итог звонка: обращение с каналом `phone` → тот же пайплайн разбора → заявка. */
export interface CallIntake {
  submit(call: CallAppeal): Promise<{ appealId: string; ticketId: string; ticketNumber: string }>;
}

export interface VoiceService {
  turn(input: TurnInput): Promise<TurnResponse>;
  end(input: EndInput): Promise<EndResponse>;
}

export interface VoiceServiceDeps {
  llm: LlmPort;
  calls: CallStore;
  intake: CallIntake;
  clock: { now(): Date };
  timeoutMs?: number;
}

export const NO_TEXT_FAREWELL = 'Не удалось разобрать обращение. Перезвоните, пожалуйста, или напишите в чат поддержки.';
export const INTAKE_FAILED_FAREWELL = 'Спасибо. Обращение записано, диспетчер перезвонит вам.';

export function farewell(ticketNumber: string, emergency: boolean): string {
  return emergency
    ? `Заявка ${ticketNumber} передана дежурному инженеру. Спасибо, до свидания.`
    : `Заявка ${ticketNumber} принята, диспетчер уже видит её. Спасибо, до свидания.`;
}

function callerText(lines: readonly CallLine[]): string {
  return lines
    .filter((line) => line.speaker === 'caller')
    .map((line) => line.text.trim())
    .filter((text) => text !== '')
    .join('\n');
}

export function createVoiceService(deps: VoiceServiceDeps): VoiceService {
  const at = (): string => deps.clock.now().toISOString();

  async function finish(call: CallRecord, say: string, ticket?: { appealId: string; ticketId: string; ticketNumber: string }): Promise<EndResponse> {
    call.status = 'ended';
    call.endedAt = at();
    call.farewell = say;
    if (ticket) {
      call.appealId = ticket.appealId;
      call.ticketId = ticket.ticketId;
      call.ticketNumber = ticket.ticketNumber;
    }
    return { ticketId: call.ticketId, ticketNumber: call.ticketNumber, say };
  }

  return {
    async turn(input) {
      const call = deps.calls.open(input.callId, input.from);
      if (call.status === 'ended') {
        return { say: call.farewell ?? NO_TEXT_FAREWELL, done: true, emergency: call.emergency, turn: 0 };
      }
      call.lines.push({ speaker: 'caller', text: input.text.trim(), at: at() });
      const decision = await dialogTurn({
        llm: deps.llm,
        lines: call.lines,
        elapsedMs: deps.clock.now().getTime() - Date.parse(call.startedAt),
        ...(deps.timeoutMs === undefined ? {} : { timeoutMs: deps.timeoutMs }),
      });
      call.emergency ||= decision.emergency;
      call.lines.push({ speaker: 'ai', text: decision.say, at: at(), source: decision.source, ms: decision.ms });
      const turn = call.lines.filter((line) => line.speaker === 'caller').length;
      return { say: decision.say, done: decision.done, emergency: decision.emergency, turn };
    },

    async end(input) {
      const call = deps.calls.open(input.callId, input.from);
      if (call.status === 'ended') {
        return { ticketId: call.ticketId, ticketNumber: call.ticketNumber, say: call.farewell ?? NO_TEXT_FAREWELL };
      }
      // Сервер мог перезапуститься посреди звонка: тогда берём расшифровку VoxEngine.
      if (call.lines.length === 0 && input.transcript.length > 0) {
        for (const line of input.transcript) call.lines.push({ ...line, at: at() });
      }
      const text = callerText(call.lines);
      if (text === '') return finish(call, NO_TEXT_FAREWELL);
      try {
        const ticket = await deps.intake.submit({
          callId: call.id,
          from: call.from,
          text,
          lines: call.lines,
          emergency: call.emergency,
        });
        return await finish(call, farewell(ticket.ticketNumber, call.emergency), ticket);
      } catch {
        return finish(call, INTAKE_FAILED_FAREWELL);
      }
    },
  };
}
