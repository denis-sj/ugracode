import { describe, expect, it } from 'vitest';
import { MemoryStore } from '@ugra/core';
import { buildServer, type AppContext } from '../src/server';
import { PRINTER_TEXT, seedUsers, testPorts, testReferenceData } from './helpers';

async function makeApp(env: Record<string, string> = {}): Promise<{
  ctx: AppContext;
  store: MemoryStore;
  cookie: string;
  ticketId: string;
  appealId: string;
}> {
  const store = new MemoryStore();
  const { applicant } = await seedUsers(store);
  const ctx = await buildServer({
    store,
    ports: testPorts(),
    data: testReferenceData(),
    env: { AI_MODE: 'stub', ...env },
  });
  const session = await ctx.app.inject({ method: 'POST', url: '/api/session', payload: { userId: applicant.id } });
  expect(session.statusCode).toBe(200);
  const rawCookie = session.headers['set-cookie'];
  const cookie = String(Array.isArray(rawCookie) ? rawCookie[0] : rawCookie).split(';')[0] ?? '';
  const created = await ctx.app.inject({
    method: 'POST',
    url: '/api/appeals',
    headers: { cookie },
    payload: { text: PRINTER_TEXT },
  });
  expect(created.statusCode).toBe(200);
  const body = created.json() as { appealId: string; ticketId: string; runId: string };
  return { ctx, store, cookie, ticketId: body.ticketId, appealId: body.appealId };
}

describe('сквозной срез: текст → пайплайн → заявка', () => {
  it('создаёт заявку с полями из текста и отдаёт её по GET', async () => {
    const { ctx, ticketId, appealId, cookie } = await makeApp();
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/tickets/${ticketId}`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      ticket: { status: string; number: string; appealId: string };
      appeal: { originalText: string };
      fields: { fieldKey: string; value: string }[];
      steps: { stepId: string; status: string }[];
    };
    expect(body.ticket.appealId).toBe(appealId);
    expect(body.ticket.number).toMatch(/^З-\d{8}-\d{4}$/);
    expect(body.ticket.status).toBe('in_review');
    expect(body.appeal.originalText).toBe(PRINTER_TEXT);
    const fields = Object.fromEntries(body.fields.map((field) => [field.fieldKey, field.value]));
    expect(fields.building).toBe('Б');
    expect(fields.cabinet).toBe('312');
    expect(fields.equipment).toContain('принтер HP');
    const stepIds = body.steps.map((step) => step.stepId);
    expect(stepIds).toContain('intake.normalize');
    expect(stepIds).toContain('example.extract');
    expect(stepIds).toContain('finalize');
  });

  it('отдаёт заявку в списке с фильтром по статусу', async () => {
    const { ctx, cookie } = await makeApp();
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/tickets?status=in_review',
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { tickets: unknown[] };
    expect(body.tickets).toHaveLength(1);
  });

  it('стрим отдаёт завершённый разбор', async () => {
    const { ctx, appealId, cookie } = await makeApp();
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/appeals/${appealId}/stream`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('run.completed');
    expect(response.body).toContain('step.completed');
  });
});

describe('ошибки API', () => {
  it('без входа не создаёт обращение', async () => {
    const store = new MemoryStore();
    await seedUsers(store);
    const ctx = await buildServer({ store, ports: testPorts(), data: testReferenceData(), env: { AI_MODE: 'stub' } });
    const response = await ctx.app.inject({ method: 'POST', url: '/api/appeals', payload: { text: PRINTER_TEXT } });
    expect(response.statusCode).toBe(401);
  });

  it('отклоняет пустой текст', async () => {
    const { ctx, cookie } = await makeApp();
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/appeals',
      headers: { cookie },
      payload: { text: '' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('неизвестная заявка — 404', async () => {
    const { ctx, cookie } = await makeApp();
    const response = await ctx.app.inject({ method: 'GET', url: '/api/tickets/nope', headers: { cookie } });
    expect(response.statusCode).toBe(404);
  });

  it('неизвестный пользователь — 404', async () => {
    const store = new MemoryStore();
    await seedUsers(store);
    const ctx = await buildServer({ store, ports: testPorts(), data: testReferenceData(), env: { AI_MODE: 'stub' } });
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/session',
      payload: { userId: 'missing' },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('флаги фич и маршруты модулей', () => {
  it('с FEATURES_OFF=example всё стартует, полей из модуля нет', async () => {
    const { ctx, ticketId, cookie } = await makeApp({ FEATURES_OFF: 'example' });
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/tickets/${ticketId}`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { fields: unknown[]; steps: { stepId: string }[] };
    expect(body.fields).toHaveLength(0);
    expect(body.steps.map((step) => step.stepId)).not.toContain('example.extract');
  });

  it('GET /api/meta показывает включённые модули', async () => {
    const { ctx } = await makeApp();
    const meta = await ctx.app.inject({ method: 'GET', url: '/api/meta' });
    const body = meta.json() as { modules: { id: string }[]; fields: unknown[] };
    expect(body.modules.map((module) => module.id)).toContain('example');
    expect(body.fields.length).toBeGreaterThan(0);
  });

  it('маршрут модуля требует права', async () => {
    const { ctx, cookie } = await makeApp();
    const anonymous = await ctx.app.inject({ method: 'GET', url: '/api/m/example/ping' });
    expect(anonymous.statusCode).toBe(401);
    const authorized = await ctx.app.inject({
      method: 'GET',
      url: '/api/m/example/ping',
      headers: { cookie },
    });
    expect(authorized.statusCode).toBe(200);
  });
});
