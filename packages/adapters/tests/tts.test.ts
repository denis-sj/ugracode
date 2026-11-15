import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  DEFAULT_ROUTERAI_BASE_URL,
  DEFAULT_TTS_MODEL,
  DEFAULT_TTS_VOICE,
  RouterAiTts,
  StubTts,
  isWav,
  pcmToWav,
  sanitizeSecret,
  wavSeconds,
} from '@ugra/adapters';

/** 10 мс тишины: 24 кГц, моно, 16 бит. */
const PCM = new Uint8Array(480);

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return Buffer.from(bytes.subarray(offset, offset + length)).toString('ascii');
}

function u16(bytes: Uint8Array, offset: number): number {
  return Buffer.from(bytes).readUInt16LE(offset);
}

function u32(bytes: Uint8Array, offset: number): number {
  return Buffer.from(bytes).readUInt32LE(offset);
}

interface FetchCall {
  url: string;
  init: RequestInit;
}

/** Тело ответа как ArrayBuffer: `Response` не принимает Uint8Array с общим буфером. */
function responseWith(bytes: Uint8Array, status = 200): Response {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Response(copy.buffer, { status });
}

/** Подмена сети: запоминает вызов и отдаёт заданный ответ. */
function fetchStub(reply: () => Response | Promise<Response>): { fetch: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const stub: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    return reply();
  };
  return { fetch: stub, calls };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('pcmToWav', () => {
  it('дописывает заголовок RIFF/WAVE: 24 кГц, моно, 16 бит', () => {
    const wav = pcmToWav(PCM);

    expect(wav.byteLength).toBe(PCM.byteLength + 44);
    expect(ascii(wav, 0, 4)).toBe('RIFF');
    expect(ascii(wav, 8, 4)).toBe('WAVE');
    expect(ascii(wav, 12, 4)).toBe('fmt ');
    expect(u16(wav, 20)).toBe(1); // PCM без сжатия
    expect(u16(wav, 22)).toBe(1); // моно
    expect(u32(wav, 24)).toBe(24_000);
    expect(u32(wav, 28)).toBe(48_000); // байт в секунду
    expect(u16(wav, 32)).toBe(2); // выравнивание блока
    expect(u16(wav, 34)).toBe(16); // бит на сэмпл
    expect(ascii(wav, 36, 4)).toBe('data');
    expect(u32(wav, 40)).toBe(PCM.byteLength);
    expect(u32(wav, 4)).toBe(PCM.byteLength + 36);
  });

  it('идемпотентен: готовый WAV не получает второй заголовок', () => {
    const once = pcmToWav(PCM);
    const twice = pcmToWav(once);

    expect(isWav(once)).toBe(true);
    expect(twice.byteLength).toBe(once.byteLength);
    expect(ascii(twice, 0, 4)).toBe('RIFF');
    // Второй RIFF стоял бы сразу после первого заголовка — данных там нет.
    expect(ascii(twice, 44, 4)).not.toBe('RIFF');
  });

  it('считает длительность по заголовку', () => {
    expect(wavSeconds(pcmToWav(PCM))).toBeCloseTo(0.01, 3);
    expect(wavSeconds(PCM)).toBe(0);
  });
});

describe('RouterAiTts', () => {
  it('зовёт /audio/speech с Bearer и PCM-телом, ответ заворачивает в WAV', async () => {
    const { fetch, calls } = fetchStub(() => responseWith(PCM));
    const tts = new RouterAiTts({ apiKey: 'test-key', fetch });

    const result = await tts.speak({ text: 'Здравствуйте, диспетчерская' });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${DEFAULT_ROUTERAI_BASE_URL}/audio/speech`);
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-key');
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      model: DEFAULT_TTS_MODEL,
      input: 'Здравствуйте, диспетчерская',
      voice: DEFAULT_TTS_VOICE,
      response_format: 'pcm',
    });
    expect(result.mimeType).toBe('audio/wav');
    expect(result.voice).toBe(DEFAULT_TTS_VOICE);
    expect(isWav(result.audio)).toBe(true);
    expect(tts.available).toBe(true);
  });

  it('принимает голос из запроса', async () => {
    const { fetch } = fetchStub(() => responseWith(PCM));
    const tts = new RouterAiTts({ apiKey: 'test-key', fetch });

    const result = await tts.speak({ text: 'Добрый день', voice: 'Charon' });

    expect(result.voice).toBe('Charon');
  });

  it('готовый WAV от провайдера возвращает как есть', async () => {
    const wav = pcmToWav(PCM);
    const { fetch } = fetchStub(() => responseWith(wav));
    const tts = new RouterAiTts({ apiKey: 'test-key', fetch });

    const result = await tts.speak({ text: 'Уже WAV' });

    expect(result.audio.byteLength).toBe(wav.byteLength);
  });

  it('ошибка 500: в сообщении код ответа и тело, но не ключ', async () => {
    const secret = 'routerai-secret-0123456789';
    const body = `{"error":"internal","key":"${secret}","note":"Bearer ${secret}"}`;
    const { fetch } = fetchStub(() => responseWith(new TextEncoder().encode(body), 500));
    const tts = new RouterAiTts({ apiKey: secret, fetch });

    const error = await tts.speak({ text: 'Ошибка' }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain('HTTP 500');
    expect(message).not.toContain(secret);
    expect(message).toContain('***');
  });

  it('сеть недоступна: ошибка без ключа', async () => {
    const secret = 'routerai-secret-0123456789';
    const fakeFetch: typeof fetch = async () => {
      throw new Error(`connect ECONNREFUSED (key ${secret})`);
    };
    const tts = new RouterAiTts({ apiKey: secret, fetch: fakeFetch });

    const error = await tts.speak({ text: 'Ошибка' }).catch((reason: unknown) => reason);

    expect((error as Error).message).toContain('запрос не удался');
    expect((error as Error).message).not.toContain(secret);
  });

  it('пустой ответ — ошибка', async () => {
    const { fetch } = fetchStub(() => responseWith(new Uint8Array()));
    const tts = new RouterAiTts({ apiKey: 'test-key', fetch });

    await expect(tts.speak({ text: 'Тишина' })).rejects.toThrow('пустой ответ');
  });

  it('без ключа конструктор падает', () => {
    vi.stubEnv('ROUTERAI_API_KEY', '');

    expect(() => new RouterAiTts()).toThrow('ROUTERAI_API_KEY не задан');
  });

  it('таймаут ограничен 5 секундами по умолчанию', async () => {
    const { fetch, calls } = fetchStub(() => responseWith(PCM));
    const tts = new RouterAiTts({ apiKey: 'test-key', fetch });

    await tts.speak({ text: 'Проверка сигнала' });

    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('sanitizeSecret', () => {
  it('вырезает ключ, sk-… и содержимое Bearer', () => {
    const text = 'key=abc123 sk-abcdefghij Authorization: Bearer abc123';

    const clean = sanitizeSecret(text, 'abc123');

    expect(clean).not.toContain('abc123');
    expect(clean).not.toContain('sk-abcdefghij');
    expect(clean).toContain('Bearer ***');
  });
});

describe('StubTts', () => {
  it('отдаёт валидный WAV тишины без сети', async () => {
    const tts = new StubTts();

    const result = await tts.speak({ text: 'Здравствуйте' });

    expect(tts.available).toBe(false);
    expect(result.mimeType).toBe('audio/wav');
    expect(result.voice).toBe(DEFAULT_TTS_VOICE);
    expect(isWav(result.audio)).toBe(true);
    expect(wavSeconds(result.audio)).toBeCloseTo(0.2, 2);
    expect(result.audio.byteLength).toBeGreaterThan(44);
  });

  it('детерминирован и уважает голос из запроса', async () => {
    const tts = new StubTts({ voice: 'Puck' });

    const first = await tts.speak({ text: 'Раз' });
    const second = await tts.speak({ text: 'Два' });
    const other = await tts.speak({ text: 'Раз', voice: 'Charon' });

    expect(first.audio).toEqual(second.audio);
    expect(first.voice).toBe('Puck');
    expect(other.voice).toBe('Charon');
  });
});
