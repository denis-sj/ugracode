import { describe, expect, it } from 'vitest';
import type { ScreenshotResponse } from '@ugra/contracts';
import { MemoryStore } from '@ugra/core';
import type { Ports } from '@ugra/core';
import { buildServer, type AppContext } from '../src/server';
import { seedUsers, testPorts, testReferenceData } from './helpers';

interface Setup {
  ctx: AppContext;
  applicant: string;
  dispatcher: string;
}

async function setup(vision?: Ports['vision']): Promise<Setup> {
  const store = new MemoryStore();
  const users = await seedUsers(store);
  const ctx = await buildServer({
    store,
    ports: testPorts(vision ? { vision } : {}),
    data: testReferenceData(),
    // Маршрут картинки — ядро, модули для него не нужны.
    modules: [],
    env: { AI_MODE: 'stub' },
  });
  const login = async (userId: string): Promise<string> => {
    const response = await ctx.app.inject({ method: 'POST', url: '/api/session', payload: { userId } });
    const raw = response.headers['set-cookie'];
    return String(Array.isArray(raw) ? raw[0] : raw).split(';')[0] ?? '';
  };
  return { ctx, applicant: await login(users.applicant.id), dispatcher: await login(users.dispatcher.id) };
}

function post(ctx: AppContext, cookie: string | null, payload: unknown) {
  return ctx.app.inject({
    method: 'POST',
    url: '/api/screenshot',
    ...(cookie === null ? {} : { headers: { cookie } }),
    payload: payload as Record<string, unknown>,
  });
}

const IMAGE = { image: 'AAAA', mimeType: 'image/png' };

describe('POST /api/screenshot', () => {
  it('без входа — 401', async () => {
    const { ctx } = await setup();

    const response = await post(ctx, null, IMAGE);

    expect(response.statusCode).toBe(401);
  });

  it('возвращает текст распознавания и уверенность', async () => {
    const { ctx, applicant } = await setup({
      describe: async (image, promptId) => {
        expect(image).toEqual({ kind: 'image', data: 'AAAA', mimeType: 'image/png' });
        expect(promptId).toBe('modules/screenshot/prompts/read.v1.md');
        return { text: 'Ошибка E123, принтер HP', confidence: 0.88 };
      },
    });

    const response = await post(ctx, applicant, {
      image: ' data:image/png;base64,AAAA ',
      mimeType: 'image/png',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json() as ScreenshotResponse).toEqual({
      text: 'Ошибка E123, принтер HP',
      confidence: 0.88,
    });
  });

  it('диспетчеру маршрут тоже доступен', async () => {
    const { ctx, dispatcher } = await setup({ describe: async () => ({ text: 'E501' }) });

    const response = await post(ctx, dispatcher, IMAGE);

    expect(response.statusCode).toBe(200);
  });

  it('пустая картинка — 400', async () => {
    const { ctx, applicant } = await setup();

    const response = await post(ctx, applicant, { image: '', mimeType: 'image/png' });

    expect(response.statusCode).toBe(400);
  });

  it('битый base64 — 400', async () => {
    const { ctx, applicant } = await setup();

    const response = await post(ctx, applicant, { image: 'не-картинка!', mimeType: 'image/png' });

    expect(response.statusCode).toBe(400);
  });

  it('не картинка по mimeType — 400', async () => {
    const { ctx, applicant } = await setup();

    const response = await post(ctx, applicant, { image: 'AAAA', mimeType: 'application/pdf' });

    expect(response.statusCode).toBe(400);
  });

  it('сбой зрения — 502', async () => {
    const { ctx, applicant } = await setup({
      describe: async () => {
        throw new Error('нет сети');
      },
    });

    const response = await post(ctx, applicant, IMAGE);

    expect(response.statusCode).toBe(502);
  });

  it('пустое распознавание — 502', async () => {
    const { ctx, applicant } = await setup({ describe: async () => ({ text: '   ' }) });

    const response = await post(ctx, applicant, IMAGE);

    expect(response.statusCode).toBe(502);
  });
});
