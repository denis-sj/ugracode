import type { TtsPort, TtsRequest, TtsResult } from '@ugra/core';
import { DEFAULT_TTS_VOICE } from './routerai';
import { TTS_BITS, TTS_CHANNELS, TTS_SAMPLE_RATE, pcmToWav } from './pcm-wav';

/** Длительность заглушки: короткая пауза, чтобы `<audio>` успел отыграть и закрыться. */
export const STUB_TTS_MS = 200;

/**
 * Заглушка озвучки: валидный WAV тишины, без сети и без ключа.
 * Нужна тестам и режиму без `ROUTERAI_API_KEY` — страница звонка тогда озвучивает браузером.
 */
export class StubTts implements TtsPort {
  /** Заглушка не синтезирует по-настоящему: сервер ответит 503, страница озвучит браузером. */
  readonly available = false;

  private readonly voice: string;

  constructor(options: { voice?: string } = {}) {
    this.voice = options.voice ?? DEFAULT_TTS_VOICE;
  }

  async speak(request: TtsRequest): Promise<TtsResult> {
    const bytesPerSecond = TTS_SAMPLE_RATE * TTS_CHANNELS * (TTS_BITS / 8);
    const pcm = Buffer.alloc(Math.round((bytesPerSecond * STUB_TTS_MS) / 1000));
    return {
      audio: pcmToWav(pcm),
      mimeType: 'audio/wav',
      voice: request.voice ?? this.voice,
    };
  }
}
