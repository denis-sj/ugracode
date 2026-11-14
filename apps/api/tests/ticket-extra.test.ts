import { describe, expect, it } from 'vitest';
import { MemoryStore } from '@ugra/core';
import { buildServer, type AppContext } from '../src/server';
import { PRINTER_TEXT, seedUsers, testPorts, testReferenceData } from './helpers';

async function setup(): Promise<{
  ctx: AppContext;
  ticketId: string;
  applicant: string;
  dispatcher: string;
  engineer: string;
}> {
  const store = new MemoryStore();
  const users = await seedUsers(store);
  const ctx = await buildServer({
    store,
    ports: testPorts(),
    data: testReferenceData(),
    env: { AI_MODE: 'stub' },
  });
  const login = async (userId: string): Promise<string> => {
    const response = await ctx.app.inject({ method: 'POST', url: '/api/session', payload: { userId } });
    const raw = response.headers['set-cookie'];
    return String(Array.isArray(raw) ? raw[0] : raw).split(';')[0] ?? '';
  };
  const applicant = await login(users.applicant.id);
  const dispatcher = await login(users.dispatcher.id);
  const engineer = await login(users.engineer.id);
  const created = await ctx.app.inject({
    method: 'POST',
    url: '/api/appeals',
    headers: { cookie: applicant },
    payload: { text: PRINTER_TEXT },
  });
  return {
    ctx,
    ticketId: (created.json() as { ticketId: string }).ticketId,
    applicant,
    dispatcher,
    engineer,
  };
}

describe('разбор заявки для карточки', () => {
  it('отдаёт сохранённый черновик анализа', async () => {
    const { ctx, ticketId, dispatcher } = await setup();
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/tickets/${ticketId}/analysis`,
      headers: { cookie: dispatcher },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { analysis: { fields?: Record<string, { value: unknown }> }; runId: string };
    expect(body.runId.length).toBeGreaterThan(0);
    expect(body.analysis.fields?.cabinet?.value).toBe('312');
  });

  it('чужой заявитель не видит анализ', async () => {
    const { ctx, ticketId } = await setup();
    const stranger = await ctx.app.inject({
      method: 'POST',
      url: '/api/session',
      payload: { userId: 'u-stranger' },
    });
    expect(stranger.statusCode).toBe(404);
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/tickets/${ticketId}/analysis`,
    });
    expect(response.statusCode).toBe(401);
  });

  it('без разбора — 404', async () => {
    const { ctx, dispatcher } = await setup();
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/tickets/unknown/analysis',
      headers: { cookie: dispatcher },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('сроки и результат инженера', () => {
  it('продлевает срок с причиной', async () => {
    const { ctx, ticketId, dispatcher } = await setup();
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/tickets/${ticketId}/deadline`,
      headers: { cookie: dispatcher },
      payload: { slaDueAt: '2026-11-16T12:00:00.000Z', reason: 'ждём запчасть' },
    });
    expect(response.statusCode).toBe(200);
    const ticket = response.json() as { slaDueAt: string };
    expect(ticket.slaDueAt).toBe('2026-11-16T12:00:00.000Z');
    const events = await ctx.app.inject({
      method: 'GET',
      url: `/api/tickets/${ticketId}/events`,
      headers: { cookie: dispatcher },
    });
    expect(JSON.stringify(events.json())).toContain('ticket.deadline.extended');
  });

  it('инженер продлевает срок своей заявки', async () => {
    const { ctx, ticketId, engineer } = await setup();
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/tickets/${ticketId}/deadline`,
      headers: { cookie: engineer },
      payload: { slaDueAt: '2026-11-17T12:00:00.000Z', reason: 'нужна деталь' },
    });
    expect(response.statusCode).toBe(200);
    expect((response.json() as { slaDueAt: string }).slaDueAt).toBe('2026-11-17T12:00:00.000Z');
  });

  it('инженер записывает результат и закрывает заявку', async () => {
    const { ctx, ticketId, dispatcher, engineer } = await setup();
    await ctx.app.inject({
      method: 'POST',
      url: `/api/tickets/${ticketId}/confirm`,
      headers: { cookie: dispatcher },
      payload: { assigneeId: 'u-engineer-1' },
    });
    await ctx.app.inject({
      method: 'POST',
      url: `/api/tickets/${ticketId}/transition`,
      headers: { cookie: engineer },
      payload: { to: 'in_progress' },
    });
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/tickets/${ticketId}/resolution`,
      headers: { cookie: engineer },
      payload: { text: 'Заменил картридж, печать восстановлена' },
    });
    expect(response.statusCode).toBe(200);
    const ticket = response.json() as { status: string; resolution: string; resolvedAt: string };
    expect(ticket.status).toBe('resolved');
    expect(ticket.resolution).toContain('картридж');
    expect(ticket.resolvedAt).toBeTruthy();
  });

  it('заявитель не может записать результат', async () => {
    const { ctx, ticketId, applicant } = await setup();
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/tickets/${ticketId}/resolution`,
      headers: { cookie: applicant },
      payload: { text: 'сам починил' },
    });
    expect(response.statusCode).toBe(403);
  });
});

describe('возврат заявителю и фильтр аварий', () => {
  it('диспетчер возвращает заявку заявителю', async () => {
    const { ctx, ticketId, dispatcher } = await setup();
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/tickets/${ticketId}/transition`,
      headers: { cookie: dispatcher },
      payload: { to: 'waiting_applicant' },
    });
    expect(response.statusCode).toBe(200);
    expect((response.json() as { status: string }).status).toBe('waiting_applicant');
  });

  it('возврат диспетчеру сохраняет причину в событии', async () => {
    const { ctx, ticketId, dispatcher, engineer } = await setup();
    await ctx.app.inject({
      method: 'POST',
      url: `/api/tickets/${ticketId}/confirm`,
      headers: { cookie: dispatcher },
      payload: { assigneeId: 'u-engineer-1' },
    });
    const returned = await ctx.app.inject({
      method: 'POST',
      url: `/api/tickets/${ticketId}/transition`,
      headers: { cookie: engineer },
      payload: { to: 'in_review', reason: 'нужен доступ в серверную' },
    });
    expect(returned.statusCode).toBe(200);
    const events = await ctx.app.inject({
      method: 'GET',
      url: `/api/tickets/${ticketId}/events`,
      headers: { cookie: dispatcher },
    });
    expect(JSON.stringify(events.json())).toContain('нужен доступ в серверную');
  });

  it('фильтр isEmergency=false не превращается в true', async () => {
    const { ctx, dispatcher } = await setup();
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/tickets?isEmergency=false',
      headers: { cookie: dispatcher },
    });
    expect(response.statusCode).toBe(200);
    expect((response.json() as { tickets: unknown[] }).tickets).toHaveLength(1);
    const emergencies = await ctx.app.inject({
      method: 'GET',
      url: '/api/tickets?isEmergency=true',
      headers: { cookie: dispatcher },
    });
    expect((emergencies.json() as { tickets: unknown[] }).tickets).toHaveLength(0);
  });
});

describe('фоновый разбор (async)', () => {
  it('отвечает сразу с runId и не ждёт пайплайн', async () => {
    const { ctx, applicant } = await setup();
    const started = Date.now();
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/appeals',
      headers: { cookie: applicant },
      payload: { text: PRINTER_TEXT, async: true },
    });
    const took = Date.now() - started;
    expect(response.statusCode).toBe(200);
    const body = response.json() as { appealId: string; ticketId: string; runId: string };
    expect(body.runId.length).toBeGreaterThan(0);
    expect(took).toBeLessThan(1500);
  });

  it('без async работает как раньше — заявка уже разобрана', async () => {
    const { ctx, applicant } = await setup();
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/appeals',
      headers: { cookie: applicant },
      payload: { text: PRINTER_TEXT },
    });
    const body = response.json() as { ticketId: string };
    const ticket = await ctx.app.inject({
      method: 'GET',
      url: `/api/tickets/${body.ticketId}`,
      headers: { cookie: applicant },
    });
    expect((ticket.json() as { ticket: { status: string } }).ticket.status).not.toBe('new');
  });
});
