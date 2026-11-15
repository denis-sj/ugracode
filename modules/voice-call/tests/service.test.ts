import { describe, expect, it } from 'vitest';
import type { LlmChatResponse } from '@ugra/contracts';
import type { LlmPort } from '@ugra/core';
import { CallStore } from '../server/calls';
import { EMERGENCY_SAY } from '../server/dialog';
import {
  EndInput,
  INTAKE_FAILED_FAREWELL,
  NO_TEXT_FAREWELL,
  TurnInput,
  createVoiceService,
  farewell,
  type CallAppeal,
  type CallIntake,
} from '../server/service';

function clock(start = '2026-11-14T10:00:00.000Z') {
  let now = Date.parse(start);
  return { now: () => new Date(now), tick: (ms: number) => void (now += ms) };
}

function scriptedLlm(replies: string[]): LlmPort {
  let index = 0;
  return {
    structured: async () => Promise.reject(new Error('не нужен')),
    async chat(): Promise<LlmChatResponse> {
      const content = replies[index] ?? replies.at(-1) ?? null;
      index += 1;
      return { message: { role: 'assistant', content, toolCalls: [] }, finishReason: 'stop', model: 'stub' };
    },
  };
}

function intakeSpy(fail = false): CallIntake & { submitted: CallAppeal[] } {
  const spy = {
    submitted: [] as CallAppeal[],
    async submit(call: CallAppeal) {
      if (fail) throw new Error('БД недоступна');
      spy.submitted.push(call);
      return { appealId: 'a-1', ticketId: 't-1', ticketNumber: 'З-20261114-0001' };
    },
  };
  return spy;
}

function setup(replies: string[], fail = false) {
  const time = clock();
  const calls = new CallStore(time.now);
  const intake = intakeSpy(fail);
  const service = createVoiceService({ llm: scriptedLlm(replies), calls, intake, clock: time });
  return { time, calls, intake, service };
}

const ask = '{"say":"В каком кабинете?","done":false,"emergency":false}';
const thanks = '{"say":"Спасибо, записала.","done":true,"emergency":false}';

describe('сервис звонка', () => {
  it('называет номер заявки словами', () => {
    expect(farewell('З-20261114-0602', false)).toBe(
      'Заявка шестьсот два принята, диспетчер уже видит её. Спасибо, до свидания.',
    );
    expect(farewell('З-20261114-0602', true)).toBe(
      'Заявка шестьсот два передана дежурному инженеру. Спасибо, до свидания.',
    );
  });

  it('полный путь: реплики → итог → заявка с каналом звонка', async () => {
    const { service, calls, intake } = setup([ask, thanks]);
    const first = await service.turn(TurnInput.parse({ callId: 'c-1', from: 'iPhone', text: 'не печатает принтер' }));
    expect(first).toEqual({ say: 'В каком кабинете?', done: false, emergency: false, turn: 1 });
    const second = await service.turn(TurnInput.parse({ callId: 'c-1', text: '312, корпус Б' }));
    expect(second.done).toBe(true);

    const end = await service.end(EndInput.parse({ callId: 'c-1' }));
    expect(end.ticketNumber).toBe('З-20261114-0001');
    expect(end.say).toBe('Заявка один принята, диспетчер уже видит её. Спасибо, до свидания.');
    expect(intake.submitted[0]).toMatchObject({ from: 'iPhone', text: 'не печатает принтер\n312, корпус Б', emergency: false });
    expect(intake.submitted[0]?.lines).toHaveLength(4);
    expect(calls.get('c-1')?.status).toBe('ended');
  });

  it('повторный end не создаёт вторую заявку', async () => {
    const { service, intake } = setup([ask]);
    await service.turn(TurnInput.parse({ callId: 'c-2', text: 'не работает почта' }));
    const first = await service.end(EndInput.parse({ callId: 'c-2' }));
    const second = await service.end(EndInput.parse({ callId: 'c-2' }));
    expect(second).toEqual(first);
    expect(intake.submitted).toHaveLength(1);
  });

  it('turn после конца звонка отдаёт прощание', async () => {
    const { service } = setup([ask]);
    await service.turn(TurnInput.parse({ callId: 'c-3', text: 'мышь' }));
    const end = await service.end(EndInput.parse({ callId: 'c-3' }));
    const late = await service.turn(TurnInput.parse({ callId: 'c-3', text: 'ещё' }));
    expect(late).toMatchObject({ say: end.say, done: true });
  });

  it('авария отмечается в звонке и уходит в обращение', async () => {
    const { service, intake } = setup([ask]);
    const turn = await service.turn(TurnInput.parse({ callId: 'c-4', text: 'в 105 искрит розетка' }));
    expect(turn).toMatchObject({ say: EMERGENCY_SAY, done: true, emergency: true });
    const end = await service.end(EndInput.parse({ callId: 'c-4' }));
    expect(intake.submitted[0]?.emergency).toBe(true);
    expect(end.say).toContain('дежурному');
  });

  it('звонок без слов → заявку не создаём', async () => {
    const { service, intake } = setup([ask]);
    await service.turn(TurnInput.parse({ callId: 'c-5', text: '' }));
    const end = await service.end(EndInput.parse({ callId: 'c-5' }));
    expect(end).toEqual({ ticketId: null, ticketNumber: null, say: NO_TEXT_FAREWELL });
    expect(intake.submitted).toHaveLength(0);
  });

  it('сервер потерял звонок → берём расшифровку со страницы', async () => {
    const { service, intake } = setup([ask]);
    await service.end(
      EndInput.parse({
        callId: 'c-6',
        from: 'Android',
        transcript: [
          { speaker: 'ai', text: 'Здравствуйте' },
          { speaker: 'caller', text: 'сломался сканер в 204' },
        ],
      }),
    );
    expect(intake.submitted[0]?.text).toBe('сломался сканер в 204');
  });

  it('сбой создания заявки → вежливое прощание, звонок закрыт', async () => {
    const { service, calls } = setup([ask], true);
    await service.turn(TurnInput.parse({ callId: 'c-7', text: 'монитор мигает' }));
    const end = await service.end(EndInput.parse({ callId: 'c-7' }));
    expect(end).toEqual({ ticketId: null, ticketNumber: null, say: INTAKE_FAILED_FAREWELL });
    expect(calls.get('c-7')?.status).toBe('ended');
  });

  it('старые звонки забываются по TTL', async () => {
    const { service, calls, time } = setup([ask]);
    await service.turn(TurnInput.parse({ callId: 'c-8', text: 'мышь' }));
    time.tick(31 * 60 * 1000);
    expect(calls.get('c-8')).toBeNull();
    expect(calls.list()).toHaveLength(0);
  });
});

describe('входы звонка', () => {
  it('отвергает пустой callId и слишком длинную реплику', () => {
    expect(TurnInput.safeParse({ callId: '', text: 'x' }).success).toBe(false);
    expect(TurnInput.safeParse({ callId: 'c', text: 'я'.repeat(2001) }).success).toBe(false);
  });

  it('чистит подпись устройства от разметки', () => {
    expect(TurnInput.parse({ callId: 'c', from: '<b>iPhone</b>' }).from).toBe('biPhoneb');
    expect(TurnInput.parse({ callId: 'c' }).from).toBe('');
  });
});
