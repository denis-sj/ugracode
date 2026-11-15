import { describe, expect, it } from 'vitest';
import type { AppealMessage, MetaResponse, TicketResponse } from '@ugra/contracts';
import { MemoryStore } from '@ugra/core';
import { CALLS_PER_MINUTE as CALLS_LIMIT } from '../../../modules/voice-call/server/index';
import { CALL_APPLICANT } from '../../../modules/voice-call/server/intake';
import { ticketNumberWords } from '../../../modules/voice-call/server/format';
import { serverModules } from '../../../modules/registry.server';
import { buildServer, type AppContext } from '../src/server';
import { seedUsers, testPorts, testReferenceData } from './helpers';

interface Setup {
  ctx: AppContext;
  caller: string;
  dispatcher: string;
  engineer: string;
  applicant: string;
}

async function setup(env: Record<string, string | undefined> = { AI_MODE: 'stub' }): Promise<Setup> {
  const store = new MemoryStore();
  const users = await seedUsers(store);
  // Звонящий по QR не входит в систему: страница звонка логинится гостевым пользователем,
  // которого в демо создаёт сид модуля (`seed`), а здесь кладём прямо в хранилище.
  await store.saveUser(CALL_APPLICANT);
  const ctx = await buildServer({
    store,
    ports: testPorts(),
    data: testReferenceData(),
    modules: serverModules,
    env,
  });
  const login = async (userId: string): Promise<string> => {
    const response = await ctx.app.inject({ method: 'POST', url: '/api/session', payload: { userId } });
    expect(response.statusCode).toBe(200);
    const raw = response.headers['set-cookie'];
    return String(Array.isArray(raw) ? raw[0] : raw).split(';')[0] ?? '';
  };
  return {
    ctx,
    caller: await login(CALL_APPLICANT.id),
    dispatcher: await login(users.dispatcher.id),
    engineer: await login(users.engineer.id),
    applicant: await login(users.applicant.id),
  };
}

async function turn(ctx: AppContext, cookie: string, callId: string, text: string, from = 'iPhone') {
  const response = await ctx.app.inject({
    method: 'POST',
    url: '/api/m/voice-call/turn',
    headers: { cookie },
    payload: { callId, from, text },
  });
  return { response, body: response.json() as { say: string; done: boolean; emergency: boolean; turn: number } };
}

async function end(ctx: AppContext, cookie: string, callId: string, from = 'iPhone') {
  const response = await ctx.app.inject({
    method: 'POST',
    url: '/api/m/voice-call/end',
    headers: { cookie },
    payload: { callId, from, transcript: [] },
  });
  return { response, body: response.json() as { ticketId: string | null; ticketNumber: string | null; say: string } };
}

describe('звонок ИИ-оператору по QR-коду', () => {
  it('полный путь turn → end создаёт заявку с каналом phone и разговором в чате', async () => {
    const { ctx, caller, dispatcher } = await setup();
    const callId = 'call-printer-312';

    const first = await turn(ctx, caller, callId, 'Не печатает принтер в 312-м кабинете');
    expect(first.response.statusCode).toBe(200);
    expect(first.body.turn).toBe(1);
    expect(first.body.done).toBe(false);
    expect(first.body.emergency).toBe(false);
    expect(first.body.say.length).toBeGreaterThan(0);

    const second = await turn(ctx, caller, callId, 'Корпус Б, кабинет 312');
    expect(second.response.statusCode).toBe(200);
    expect(second.body.turn).toBe(2);

    const finished = await end(ctx, caller, callId);
    expect(finished.response.statusCode).toBe(200);
    expect(finished.body.ticketId).toEqual(expect.any(String));
    expect(finished.body.ticketNumber).toMatch(/^З-/);
    // Номер в прощании звучит словами: «Заявка шестьсот два принята…».
    expect(finished.body.say).toBe(
      `Заявка ${ticketNumberWords(String(finished.body.ticketNumber))} принята, диспетчер уже видит её. Спасибо, до свидания.`,
    );

    const ticket = await ctx.app.inject({
      method: 'GET',
      url: `/api/tickets/${finished.body.ticketId}`,
      headers: { cookie: dispatcher },
    });
    expect(ticket.statusCode).toBe(200);
    const detail = ticket.json() as TicketResponse;
    expect(detail.appeal).toMatchObject({ channel: 'phone', authorId: CALL_APPLICANT.id });
    expect(detail.appeal.originalText).toContain('312-м');

    const chat = await ctx.app.inject({
      method: 'GET',
      url: `/api/appeals/${detail.appeal.id}/messages`,
      headers: { cookie: dispatcher },
    });
    expect(chat.statusCode).toBe(200);
    const messages = (chat.json() as { messages: AppealMessage[] }).messages;
    const bodies = messages.map((message) => message.body);
    expect(bodies.join('\n')).toContain('QR-коду');
    expect(bodies).toContain('Не печатает принтер в 312-м кабинете');
    expect(bodies).toContain('Корпус Б, кабинет 312');
    expect(messages.some((message) => message.direction === 'out' && message.body === first.body.say)).toBe(true);

    const calls = await ctx.app.inject({ method: 'GET', url: '/api/m/voice-call/calls', headers: { cookie: dispatcher } });
    expect(calls.statusCode).toBe(200);
    const list = (calls.json() as { calls: { id: string; status: string; ticketNumber: string | null }[] }).calls;
    expect(list).toContainEqual(
      expect.objectContaining({ id: callId, status: 'ended', ticketNumber: finished.body.ticketNumber }),
    );
  });

  it('повторный end идемпотентен: второй заявки нет', async () => {
    const { ctx, caller, dispatcher } = await setup();
    await turn(ctx, caller, 'call-repeat', 'Не работает почта');
    const once = await end(ctx, caller, 'call-repeat');
    const twice = await end(ctx, caller, 'call-repeat');
    expect(twice.body.ticketId).toBe(once.body.ticketId);
    expect(twice.body.say).toBe(once.body.say);

    const tickets = await ctx.app.inject({ method: 'GET', url: '/api/tickets', headers: { cookie: dispatcher } });
    expect(tickets.statusCode).toBe(200);
    const withPhone = (tickets.json() as { tickets: { appealId: string }[] }).tickets;
    expect(withPhone).toHaveLength(1);
  });

  it('авария по словам заявителя: emergency и прощание дежурному', async () => {
    const { ctx, caller } = await setup();
    const { body } = await turn(ctx, caller, 'call-smoke', 'Идёт дым из щитовой, пахнет горелым');
    expect(body).toMatchObject({ emergency: true, done: true });
    expect(body.say).toContain('авари');

    const finished = await end(ctx, caller, 'call-smoke');
    expect(finished.body.ticketNumber).toMatch(/^З-/);
    expect(finished.body.say).toContain('дежурному');
  });

  it('лимит новых звонков с одного адреса: седьмой звонок — 429', async () => {
    const { ctx, caller } = await setup();
    for (let index = 1; index <= CALLS_LIMIT; index += 1) {
      const { response } = await turn(ctx, caller, `call-limit-${index}`, 'Не работает мышь', 'Android');
      expect(response.statusCode).toBe(200);
    }
    const { response } = await turn(ctx, caller, 'call-limit-over', 'Не работает мышь', 'Android');
    expect(response.statusCode).toBe(429);
  });

  it('лимит реплик с одного адреса: после тридцати — 429', async () => {
    const { ctx, caller } = await setup();
    // Один звонок, 30 реплик: лимит реплик общий для адреса, а не для звонка.
    for (let line = 1; line <= 30; line += 1) {
      const { response } = await turn(ctx, caller, 'call-turn', `Реплика ${line}`, 'iPhone');
      expect(response.statusCode).toBe(200);
    }
    const { response } = await turn(ctx, caller, 'call-turn', 'Ещё одна', 'iPhone');
    expect(response.statusCode).toBe(429);
  });

  it('с выключенным модулем turn недоступен, остальное работает', async () => {
    const { ctx, applicant } = await setup({ AI_MODE: 'stub', FEATURES_OFF: 'voice-call' });

    const off = await ctx.app.inject({
      method: 'POST',
      url: '/api/m/voice-call/turn',
      headers: { cookie: applicant },
      payload: { callId: 'call-off', text: 'привет' },
    });
    expect(off.statusCode).toBe(404);

    const meta = await ctx.app.inject({ method: 'GET', url: '/api/meta' });
    expect(meta.statusCode).toBe(200);
    expect((meta.json() as MetaResponse).modules.map((module) => module.id)).not.toContain('voice-call');

    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/appeals',
      headers: { cookie: applicant },
      payload: { text: 'Корпус Б, кабинет 301, не работает почта' },
    });
    expect(created.statusCode).toBe(200);
    expect((created.json() as { ticketId: string }).ticketId).toEqual(expect.any(String));
  });

  it('без права tickets.queue звонки не читаются: 403', async () => {
    const { ctx, engineer } = await setup();
    const calls = await ctx.app.inject({ method: 'GET', url: '/api/m/voice-call/calls', headers: { cookie: engineer } });
    expect(calls.statusCode).toBe(403);
    const active = await ctx.app.inject({
      method: 'GET',
      url: '/api/m/voice-call/calls/active',
      headers: { cookie: engineer },
    });
    expect(active.statusCode).toBe(403);
  });

  it('без входа turn закрыт: гость входит перед звонком', async () => {
    const { ctx } = await setup();
    const anonymous = await ctx.app.inject({
      method: 'POST',
      url: '/api/m/voice-call/turn',
      payload: { callId: 'call-anon', text: 'привет' },
    });
    expect(anonymous.statusCode).toBe(401);
  });
});
