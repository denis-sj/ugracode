import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { hasPermission, type Permission } from '@ugra/contracts';
import type { KernelStore, Ports, TtsResult } from '@ugra/core';
import { resolveRequestUser } from './auth';

/** Право на озвучку: её просит страница звонка, а звонок доступен роли с `appeal.create`. */
export const TTS_PERMISSION: Permission = 'appeal.create';
/** Сколько фраз держим в памяти процесса: повторные реплики не стоят денег. */
export const TTS_CACHE_LIMIT = 200;
/** Кэш на клиенте: одна и та же фраза не перезапрашивается в течение звонка. */
const CACHE_CONTROL = 'private, max-age=600';

/** Текст реплики ИИ-оператора: короткий, без пустых строк. Голос — имя из каталога Gemini TTS. */
export const TtsInput = z.object({
  text: z.string().trim().min(1, 'Пустой текст').max(400, 'Не длиннее 400 символов'),
  voice: z
    .string()
    .regex(/^[A-Za-z][A-Za-z0-9]{2,29}$/, 'Голос: латиница, 3–30 символов')
    .optional(),
});
export type TtsInput = z.infer<typeof TtsInput>;

/** Ключ кэша: голос и текст. Один и тот же текст другим голосом — отдельная запись. */
export function ttsCacheKey(text: string, voice: string): string {
  return createHash('sha256').update(`${voice}\n${text}`, 'utf8').digest('hex');
}

/** Кэш озвучки в памяти процесса: FIFO на 200 записей, старейшая вытесняется. */
export class TtsCache {
  private readonly entries = new Map<string, Uint8Array>();

  constructor(private readonly limit = TTS_CACHE_LIMIT) {}

  get size(): number {
    return this.entries.size;
  }

  get(key: string): Uint8Array | undefined {
    return this.entries.get(key);
  }

  set(key: string, audio: Uint8Array): void {
    if (!this.entries.has(key) && this.entries.size >= this.limit) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, audio);
  }
}

export interface TtsRouteOptions {
  store: KernelStore;
  ports: Ports;
  cache?: TtsCache;
}

/** Ответ озвучки: WAV плюс признак кэша. Заголовки одинаковы для попадания и промаха. */
function sendWav(reply: FastifyReply, audio: Uint8Array, cache: 'hit' | 'miss'): FastifyReply {
  return reply
    .code(200)
    .header('content-type', 'audio/wav')
    .header('x-tts-cache', cache)
    .header('cache-control', CACHE_CONTROL)
    .send(Buffer.from(audio));
}

/** Нет ключа или сбой синтеза: страница звонка озвучит фразу браузером. */
function unavailable(reply: FastifyReply): FastifyReply {
  return reply.code(503).send({ error: 'tts_unavailable', message: 'Озвучка недоступна' });
}

/**
 * `POST /api/tts`: текст реплики → WAV. Отдельный маршрут, а не `addRoute`,
 * потому что ответ — аудио, а не JSON. Сбой синтеза — 503, фронтенд озвучит браузером.
 * Ключ RouterAI и текст ошибки провайдера наружу не выходят.
 */
export function registerTtsRoute(app: FastifyInstance, options: TtsRouteOptions): TtsCache {
  const cache = options.cache ?? new TtsCache();

  app.post('/api/tts', async (request, reply) => {
    const user = await resolveRequestUser(request, options.store);
    if (!user) return reply.code(401).send({ error: 'unauthorized', message: 'Нужен вход' });
    if (!hasPermission(user.role, TTS_PERMISSION)) {
      return reply.code(403).send({ error: 'forbidden', message: 'Нет права на озвучку' });
    }

    const parsed = TtsInput.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation', message: parsed.error.message });
    }
    // Без ключа RouterAI порт не синтезирует: отдаём 503, чтобы страница звонка взяла speechSynthesis.
    if (!options.ports.tts.available) return unavailable(reply);

    const { text, voice } = parsed.data;
    const key = ttsCacheKey(text, voice ?? '');
    const cached = cache.get(key);
    if (cached) {
      return sendWav(reply, cached, 'hit');
    }

    let result: TtsResult;
    try {
      result = await options.ports.tts.speak(voice === undefined ? { text } : { text, voice });
    } catch {
      // Причину не пишем: в сообщении провайдера может оказаться ключ. Клиент озвучит браузером.
      request.log.warn('озвучка недоступна: сбой провайдера');
      return unavailable(reply);
    }

    cache.set(key, result.audio);
    request.log.info({ voice: result.voice, bytes: result.audio.byteLength }, 'озвучка готова');
    return sendWav(reply, result.audio, 'miss');
  });

  return cache;
}

/**
 * Прогрев: типовые фразы звонка синтезируются при старте API и лежат в кэше.
 * Тогда приветствие звучит сразу после «Ответить», даже если телефон отсканировал QR секунду назад.
 * По одной фразе, чтобы не упереться в лимит провайдера; сбой не мешает запуску.
 */
export async function warmTts(
  cache: TtsCache,
  ports: Pick<Ports, 'tts'>,
  texts: readonly string[],
): Promise<number> {
  if (!ports.tts.available) return 0;
  let warmed = 0;
  for (const raw of texts) {
    const text = raw.replace(/\s+/g, ' ').trim();
    if (text === '') continue;
    const key = ttsCacheKey(text, '');
    if (cache.get(key)) continue;
    try {
      const result = await ports.tts.speak({ text });
      cache.set(key, result.audio);
      warmed += 1;
    } catch {
      // Провайдер недоступен — фраза синтезируется по первому запросу, как раньше.
    }
  }
  return warmed;
}
