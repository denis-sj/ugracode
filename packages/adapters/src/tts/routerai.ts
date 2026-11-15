import type { TtsPort, TtsRequest, TtsResult } from '@ugra/core';
import { pcmToWav, trimSilence } from './pcm-wav';

export const DEFAULT_ROUTERAI_BASE_URL = 'https://routerai.ru/api/v1';
export const DEFAULT_TTS_MODEL = 'google/gemini-3.8-flash-lite-tts';
export const DEFAULT_TTS_VOICE = 'Kore';
/** Ответ дольше этого — считаем сбоем: страница звонка озвучит фразу браузером. */
export const DEFAULT_TTS_TIMEOUT_MS = 5_000;
/** Сколько символов тела ошибки оставляем в сообщении (без ключа). */
const ERROR_BODY_LIMIT = 200;

export interface RouterAiTtsOptions {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  voice?: string;
  timeoutMs?: number;
  /** Подмена сети в тестах. По умолчанию глобальный `fetch`. */
  fetch?: typeof fetch;
}

/**
 * Убирает секреты из текста ошибки или лога: сам ключ, `sk-…` и содержимое `Authorization`.
 * Ошибки RouterAI уходят клиенту и в логи — ключ там появляться не должен никогда.
 */
export function sanitizeSecret(text: string, apiKey?: string): string {
  let result = apiKey ? text.split(apiKey).join('***') : text;
  result = result.replace(/sk-[A-Za-z0-9_-]{8,}/g, '***');
  return result.replace(/Bearer\s+\S+/g, 'Bearer ***');
}

function describeError(error: unknown, apiKey?: string): string {
  const message = error instanceof Error ? error.message : String(error);
  return sanitizeSecret(message, apiKey).slice(0, ERROR_BODY_LIMIT);
}

/**
 * Озвучка через RouterAI (`POST /audio/speech`, формат OpenAI Audio Speech).
 * Модель Gemini TTS отдаёт только PCM; в WAV заворачиваем здесь, идемпотентно.
 */
export class RouterAiTts implements TtsPort {
  readonly available = true;

  private readonly apiKey: string;
  private readonly baseURL: string;
  private readonly model: string;
  private readonly voice: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: RouterAiTtsOptions = {}) {
    const apiKey = options.apiKey ?? process.env.ROUTERAI_API_KEY;
    if (!apiKey) {
      throw new Error('ROUTERAI_API_KEY не задан: озвучка RouterAI недоступна');
    }
    this.apiKey = apiKey;
    this.baseURL = (options.baseURL ?? process.env.ROUTERAI_BASE_URL ?? DEFAULT_ROUTERAI_BASE_URL).replace(/\/$/, '');
    this.model = options.model ?? process.env.ROUTERAI_TTS_MODEL ?? DEFAULT_TTS_MODEL;
    this.voice = options.voice ?? process.env.ROUTERAI_TTS_VOICE ?? DEFAULT_TTS_VOICE;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TTS_TIMEOUT_MS;
    this.fetchImpl = options.fetch ?? fetch;
  }

  async speak(request: TtsRequest): Promise<TtsResult> {
    const voice = request.voice ?? this.voice;
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseURL}/audio/speech`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          input: request.text,
          voice,
          response_format: 'pcm',
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      // Причину пересказываем очищенной: исходная ошибка могла содержать ключ.
      // eslint-disable-next-line preserve-caught-error -- cause с сырым текстом мог бы унести ключ в лог
      throw new Error(`RouterAI TTS: запрос не удался — ${describeError(error, this.apiKey)}`);
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const detail = sanitizeSecret(body, this.apiKey).slice(0, ERROR_BODY_LIMIT);
      throw new Error(`RouterAI TTS: HTTP ${response.status}${detail === '' ? '' : ` — ${detail}`}`);
    }
    const audio = new Uint8Array(await response.arrayBuffer());
    if (audio.byteLength === 0) throw new Error('RouterAI TTS: пустой ответ');
    // Gemini TTS начинает с паузы 160–280 мс: подрезаем её, иначе звук «задумывается» до первого слова.
    return { audio: trimSilence(pcmToWav(audio)), mimeType: 'audio/wav', voice };
  }
}
