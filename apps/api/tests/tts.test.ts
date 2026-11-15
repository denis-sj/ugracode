import { describe, expect, it } from 'vitest';
import type { User } from '@ugra/contracts';
import type { TtsPort, TtsRequest } from '@ugra/core';
import { MemoryStore } from '@ugra/core';
import { StubTts, pcmToWav } from '@ugra/adapters';
import { buildServer, type AppContext } from '../src/server';
import { TTS_CACHE_LIMIT, TtsCache, ttsCacheKey } from '../src/tts';
import { seedUsers, testPorts, testReferenceData } from './helpers';

/** 10 мс тишины в WAV — то, что вернул бы порт озвучки. */
const AUDIO = pcmToWav(new Uint8Array(480));

/** Порт-счётчик вызовов и его ответ; `available` — настроен ли синтез. */
function countingTts(
  reply?: () => Promise<never>,
  available = true,
): { tts: TtsPort; calls: TtsRequest[] } {
  const calls: TtsRequest[] = [];
  const tts: TtsPort = {
    available,
    async speak(request) {
      calls.push(request);
      if (reply) return reply();
      return { audio: AUDIO, mimeType: 'audio/wav', voice: request.voice ?? 'Kore' };
    },
  };
  return { tts, calls };
}

interface Setup {
  ctx: AppContext;
  cookie: string;
  calls: TtsRequest[];
}

async function setup(): Promise<Setup> {
  const store = new MemoryStore();
  const users = await seedUsers(store);
  const port = countingTts();
  const ctx = await buildServer({
    store,
    ports: testPorts({ tts: port.tts }),
    data: testReferenceData(),
    env: { AI_MODE: 'stub' },
  });
  const session = await ctx.app.inject({ method: 'POST', url: '/api/session', payload: { userId: users.applicant.id } });
  const raw = session.headers['set-cookie'];
  const cookie = String(Array.isArray(raw) ? raw[0] : raw).split(';')[0] ?? '';
  return { ctx, cookie, calls: port.calls };
}

function post(ctx: AppContext, cookie: string | null, payload: unknown) {
  return ctx.app.inject({
    method: 'POST',
    url: '/api/tts',
    ...(cookie === null ? {} : { headers: { cookie } }),
    payload: payload as Record<string, unknown>,
  });
}

describe('POST /api/tts', () => {
  it('озвучивает реплику: WAV, кэш промахнулся', async () => {
    const { ctx, cookie } = await setup();

    const response = await post(ctx, cookie, { text: 'Здравствуйте, диспетчерская' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('audio/wav');
    expect(response.headers['x-tts-cache']).toBe('miss');
    expect(response.headers['cache-control']).toBe('private, max-age=600');
    expect(Buffer.compare(Buffer.from(AUDIO), response.rawPayload)).toBe(0);
  });

  it('порт без ключа (StubTts) — 503, тишину не отдаём', async () => {
    const store = new MemoryStore();
    const users = await seedUsers(store);
    const ctx = await buildServer({
      store,
      ports: testPorts({ tts: new StubTts() }),
      data: testReferenceData(),
      env: { AI_MODE: 'stub' },
    });
    const session = await ctx.app.inject({ method: 'POST', url: '/api/session', payload: { userId: users.applicant.id } });
    const raw = session.headers['set-cookie'];
    const cookie = String(Array.isArray(raw) ? raw[0] : raw).split(';')[0] ?? '';

    const response = await post(ctx, cookie, { text: 'Здравствуйте' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'tts_unavailable', message: 'Озвучка недоступна' });
    expect(response.headers['x-tts-cache']).toBeUndefined();
    expect(response.headers['content-type']).toContain('application/json');
  });

  it('недоступный порт не вызывается и не кэшируется', async () => {
    const store = new MemoryStore();
    const users = await seedUsers(store);
    const port = countingTts(undefined, false);
    const ctx = await buildServer({
      store,
      ports: testPorts({ tts: port.tts }),
      data: testReferenceData(),
      env: { AI_MODE: 'stub' },
    });
    const session = await ctx.app.inject({ method: 'POST', url: '/api/session', payload: { userId: users.applicant.id } });
    const raw = session.headers['set-cookie'];
    const cookie = String(Array.isArray(raw) ? raw[0] : raw).split(';')[0] ?? '';

    const first = await post(ctx, cookie, { text: 'Ваша заявка принята' });
    const second = await post(ctx, cookie, { text: 'Ваша заявка принята' });

    expect(first.statusCode).toBe(503);
    expect(second.statusCode).toBe(503);
    expect(second.headers['x-tts-cache']).toBeUndefined();
    expect(port.calls).toHaveLength(0);
  });

  it('повторная фраза берётся из кэша: порт зовём один раз', async () => {
    const { ctx, cookie, calls } = await setup();
    const payload = { text: 'Ваша заявка принята' };

    const first = await post(ctx, cookie, payload);
    const second = await post(ctx, cookie, payload);

    expect(first.statusCode).toBe(200);
    expect(first.headers['x-tts-cache']).toBe('miss');
    expect(second.statusCode).toBe(200);
    expect(second.headers['x-tts-cache']).toBe('hit');
    expect(calls).toHaveLength(1);
    expect(Buffer.compare(Buffer.from(AUDIO), second.rawPayload)).toBe(0);
  });

  it('другой голос — отдельная запись кэша', async () => {
    const { ctx, cookie, calls } = await setup();

    await post(ctx, cookie, { text: 'Добрый день', voice: 'Kore' });
    const second = await post(ctx, cookie, { text: 'Добрый день', voice: 'Charon' });

    expect(second.statusCode).toBe(200);
    expect(second.headers['x-tts-cache']).toBe('miss');
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual({ text: 'Добрый день', voice: 'Charon' });
  });

  it('без входа — 401', async () => {
    const { ctx } = await setup();

    const response = await post(ctx, null, { text: 'Здравствуйте' });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: 'unauthorized' });
  });

  it('роль без права — 403', async () => {
    const store = new MemoryStore();
    const users = await seedUsers(store);
    // Роль вне матрицы прав: `hasPermission` вернёт false, синтез не запускается.
    const auditor: User = { ...users.applicant, id: 'u-auditor-1', role: 'auditor' as User['role'] };
    await store.saveUser(auditor);
    const port = countingTts();
    const ctx = await buildServer({
      store,
      ports: testPorts({ tts: port.tts }),
      data: testReferenceData(),
      env: { AI_MODE: 'stub' },
    });
    const session = await ctx.app.inject({ method: 'POST', url: '/api/session', payload: { userId: auditor.id } });
    const raw = session.headers['set-cookie'];
    const cookie = String(Array.isArray(raw) ? raw[0] : raw).split(';')[0] ?? '';

    const response = await post(ctx, cookie, { text: 'Здравствуйте' });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: 'forbidden' });
    expect(port.calls).toHaveLength(0);
  });

  it('пустой текст — 400', async () => {
    const { ctx, cookie } = await setup();

    const response = await post(ctx, cookie, { text: '   ' });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'validation' });
  });

  it('текст длиннее 400 символов — 400', async () => {
    const { ctx, cookie, calls } = await setup();

    const response = await post(ctx, cookie, { text: 'я'.repeat(401) });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'validation' });
    expect(calls).toHaveLength(0);
  });

  it('голос с недопустимыми символами — 400', async () => {
    const { ctx, cookie } = await setup();

    const response = await post(ctx, cookie, { text: 'Здравствуйте', voice: 'Kore<script>' });

    expect(response.statusCode).toBe(400);
  });

  it('сбой порта — 503 без ключа и подробностей', async () => {
    const store = new MemoryStore();
    const users = await seedUsers(store);
    const port = countingTts(async () => Promise.reject(new Error('HTTP 500: key sk-secret-0123456789')));
    const ctx = await buildServer({
      store,
      ports: testPorts({ tts: port.tts }),
      data: testReferenceData(),
      env: { AI_MODE: 'stub' },
    });
    const session = await ctx.app.inject({ method: 'POST', url: '/api/session', payload: { userId: users.applicant.id } });
    const raw = session.headers['set-cookie'];
    const cookie = String(Array.isArray(raw) ? raw[0] : raw).split(';')[0] ?? '';

    const response = await post(ctx, cookie, { text: 'Здравствуйте' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'tts_unavailable', message: 'Озвучка недоступна' });
    expect(response.body).not.toContain('sk-secret');
  });
});

describe('кэш озвучки', () => {
  it('ключ зависит от текста и голоса', () => {
    expect(ttsCacheKey('привет', 'Kore')).not.toBe(ttsCacheKey('привет', 'Charon'));
    expect(ttsCacheKey('привет', 'Kore')).toBe(ttsCacheKey('привет', 'Kore'));
  });

  it('вытесняет старейшую запись после 200', () => {
    const cache = new TtsCache();
    for (let index = 0; index < TTS_CACHE_LIMIT; index += 1) cache.set(`key-${index}`, AUDIO);
    expect(cache.size).toBe(TTS_CACHE_LIMIT);

    cache.set('new-key', AUDIO);

    expect(cache.size).toBe(TTS_CACHE_LIMIT);
    expect(cache.get('key-0')).toBeUndefined();
    expect(cache.get('key-1')).toBeDefined();
    expect(cache.get('new-key')).toBeDefined();
  });
});
