import { describe, expect, it } from 'vitest';
import type { Appeal } from '@ugra/contracts';
import { MemoryStore, defineModule } from '@ugra/core';
import { buildServer } from '../src/server';
import { testPorts, testReferenceData } from './helpers';

const appeal = (id: string): Appeal => ({
  id,
  channel: 'phone',
  authorId: 'u-caller',
  originalText: 'Корпус Б, кабинет 312, не печатает принтер',
  attachments: [],
  createdAt: '2026-11-14T10:00:00.000Z',
});

/** Модуль-проба: эхо заголовков и приём обращения через `deps.appeals`. */
const probe = defineModule({
  id: 'probe',
  title: 'Проба точек расширения',
  enabledByDefault: true,
  routes(router, deps) {
    router.get('/headers', 'any', async ({ headers }) => ({ forwarded: headers?.['x-forwarded-for'] ?? null }));
    router.post('/submit', 'any', async ({ body }) => {
      const input = body as { id: string; wait: boolean };
      if (!deps.appeals) throw new Error('нет appeals');
      return deps.appeals.submit(appeal(input.id), { wait: input.wait });
    });
  },
});

async function setup(store = new MemoryStore()) {
  return buildServer({ store, ports: testPorts(), data: testReferenceData(), modules: [probe], env: { AI_MODE: 'stub' } });
}

describe('точки расширения ядра: headers и appeals.submit', () => {
  it('обработчик модуля видит заголовки запроса в нижнем регистре', async () => {
    const ctx = await setup();
    const response = await ctx.app.inject({ method: 'GET', url: '/api/m/probe/headers', headers: { 'X-Forwarded-For': '10.0.0.7' } });
    expect(response.json()).toEqual({ forwarded: '10.0.0.7' });
  });

  it('submit с ожиданием: заявка разобрана тем же пайплайном, есть runId', async () => {
    const store = new MemoryStore();
    const ctx = await setup(store);
    const response = await ctx.app.inject({ method: 'POST', url: '/api/m/probe/submit', payload: { id: 'a-wait', wait: true } });
    const result = response.json() as { ticketId: string; ticketNumber: string; runId: string | null };
    expect(response.statusCode).toBe(200);
    expect(result.runId).toEqual(expect.any(String));
    expect(result.ticketNumber).toMatch(/^З-/);
    expect((await store.getTicket(result.ticketId))?.status).not.toBe('new');
    expect(await store.getAppeal('a-wait')).toMatchObject({ channel: 'phone' });
    const events = await store.listEvents();
    expect(events.map((event) => event.type)).toContain('appeal.created');
  });

  it('submit без ожидания: заявка есть сразу, разбор идёт в фоне', async () => {
    const store = new MemoryStore();
    const ctx = await setup(store);
    const result = await ctx.appeals.submit(appeal('a-bg'), { wait: false });
    expect(result.runId).toBeNull();
    expect(await store.getTicket(result.ticketId)).not.toBeNull();
  });

  it('ошибка хранилища: submit падает и заявку не создаёт', async () => {
    const store = new MemoryStore();
    store.saveAppeal = async () => Promise.reject(new Error('БД недоступна'));
    const ctx = await setup(store);
    await expect(ctx.appeals.submit(appeal('a-fail'))).rejects.toThrow('БД недоступна');
    expect(await store.listTickets()).toHaveLength(0);
  });
});
