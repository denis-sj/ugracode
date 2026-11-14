import { describe, expect, it } from 'vitest';
import { MemoryStore } from '@ugra/core';
import { buildServer } from '../src/server';
import { PRINTER_TEXT, seedUsers, testPorts, testReferenceData } from './helpers';

async function appWith(overrides: Parameters<typeof testPorts>[0] = {}) {
  const store = new MemoryStore();
  const users = await seedUsers(store);
  const ctx = await buildServer({
    store,
    ports: testPorts(overrides),
    data: testReferenceData(),
    env: { AI_MODE: 'stub' },
  });
  const session = await ctx.app.inject({
    method: 'POST',
    url: '/api/session',
    payload: { userId: users.applicant.id },
  });
  const raw = session.headers['set-cookie'];
  const cookie = String(Array.isArray(raw) ? raw[0] : raw).split(';')[0] ?? '';
  const created = await ctx.app.inject({
    method: 'POST',
    url: '/api/appeals',
    headers: { cookie },
    payload: { text: PRINTER_TEXT },
  });
  const ticketId = (created.json() as { ticketId: string }).ticketId;
  return { ctx, cookie, ticketId, users };
}

describe('POST /api/transcribe', () => {
  it('распознаёт речь вошедшего пользователя', async () => {
    const { ctx, cookie } = await appWith({
      speech: {
        transcribe: async () => ({ text: 'Принтер в кабинете 312 не печатает', language: 'ru', confidence: 0.9 }),
      },
    });
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/transcribe',
      headers: { cookie },
      payload: { audio: 'AAAA', mimeType: 'audio/wav' },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { text: string };
    expect(body.text.length).toBeGreaterThan(0);
  });

  it('не пускает анонимного пользователя', async () => {
    const { ctx } = await appWith();
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/transcribe',
      payload: { audio: 'AAAA', mimeType: 'audio/wav' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('отклоняет пустой звук', async () => {
    const { ctx, cookie } = await appWith();
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/transcribe',
      headers: { cookie },
      payload: { audio: '', mimeType: 'audio/wav' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('возвращает 502, если распознавание упало', async () => {
    const { ctx, cookie } = await appWith({
      speech: { transcribe: async () => Promise.reject(new Error('нет модели')) },
    });
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/transcribe',
      headers: { cookie },
      payload: { audio: 'AAAA', mimeType: 'audio/wav' },
    });
    expect(response.statusCode).toBe(502);
  });
});

describe('новые переходы: инженер возвращает диспетчеру', () => {
  it('assigned → in_review с причиной и событием ticket.returned', async () => {
    const { ctx, ticketId, users } = await appWith();
    const dispatcher = await ctx.app.inject({
      method: 'POST',
      url: '/api/session',
      payload: { userId: users.dispatcher.id },
    });
    const rawDispatcher = dispatcher.headers['set-cookie'];
    const dispatcherCookie = String(Array.isArray(rawDispatcher) ? rawDispatcher[0] : rawDispatcher).split(';')[0] ?? '';
    await ctx.app.inject({
      method: 'POST',
      url: `/api/tickets/${ticketId}/confirm`,
      headers: { cookie: dispatcherCookie },
      payload: { assigneeId: users.engineer.id },
    });
    const engineer = await ctx.app.inject({
      method: 'POST',
      url: '/api/session',
      payload: { userId: users.engineer.id },
    });
    const rawEngineer = engineer.headers['set-cookie'];
    const engineerCookie = String(Array.isArray(rawEngineer) ? rawEngineer[0] : rawEngineer).split(';')[0] ?? '';
    const returned = await ctx.app.inject({
      method: 'POST',
      url: `/api/tickets/${ticketId}/transition`,
      headers: { cookie: engineerCookie },
      payload: { to: 'in_review' },
    });
    expect(returned.statusCode).toBe(200);
    const events = await ctx.store.listEvents({ ticketId });
    expect(events.map((event) => event.type)).toContain('ticket.returned');
  });
});
