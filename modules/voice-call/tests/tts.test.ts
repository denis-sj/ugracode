// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CALL_CLARIFICATIONS, CALL_PREFETCH, GREETING, THINKING_SAY } from '../web/call-flow';
import {
  SPEECH_TIMEOUT_MS,
  TTS_MAX_CHARS,
  TtsError,
  buildSpeechCacheKey,
  createVoicePlayer,
  fetchSpeech,
  shouldFallback,
  type SpeechSynthRequest,
} from '../web/tts';

/** Поддельный `Audio`: сразу «доигрывает», запоминает источник и слушателей. */
class FakeAudio {
  src = '';
  muted = false;
  static instances = 0;
  private readonly listeners = new Map<string, Set<() => void>>();

  constructor() {
    FakeAudio.instances += 1;
  }

  play(): Promise<void> {
    queueMicrotask(() => this.emit('ended'));
    return Promise.resolve();
  }

  pause(): void {
    /* пауза ничего не ломает */
  }

  load(): void {
    /* перезагрузка источника не нужна */
  }

  removeAttribute(name: string): void {
    if (name === 'src') this.src = '';
  }

  addEventListener(type: string, listener: () => void): void {
    const set = this.listeners.get(type) ?? new Set<() => void>();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  private emit(type: string): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener();
  }
}

/** Голос браузера: как настоящий на короткой фразе — сразу присылает `onend`. */
class FakeUtterance {
  text: string;
  lang = '';
  rate = 1;
  pitch = 1;
  volume = 1;
  voice: unknown = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(text: string) {
    this.text = text;
  }
}

let urlSeq = 0;
const createObjectURL = vi.fn((_blob: Blob): string => `blob:test/${(urlSeq += 1)}`);
const revokeObjectURL = vi.fn((_url: string): void => undefined);

function wav(size = 48): Blob {
  return new Blob([new Uint8Array(size)], { type: 'audio/wav' });
}

/** Включить «голос браузера»: без него запасной путь честно молчит. */
function stubBrowserSpeech(): { speak: ReturnType<typeof vi.fn>; spoken: string[] } {
  const spoken: string[] = [];
  const speak = vi.fn((utterance: FakeUtterance) => {
    spoken.push(utterance.text);
    queueMicrotask(() => utterance.onend?.());
  });
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  vi.stubGlobal('speechSynthesis', { getVoices: () => [], cancel: () => undefined, speak });
  return { speak, spoken };
}

beforeEach(() => {
  vi.clearAllMocks();
  urlSeq = 0;
  FakeAudio.instances = 0;
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal('speechSynthesis', undefined);
  vi.stubGlobal('SpeechSynthesisUtterance', undefined);
  URL.createObjectURL = createObjectURL;
  URL.revokeObjectURL = revokeObjectURL;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('ключ кэша и решение о запасном пути', () => {
  it('схлопывает пробелы и различает голоса', () => {
    expect(buildSpeechCacheKey('  Привет \n  мир ')).toBe('Привет мир');
    expect(buildSpeechCacheKey('Привет', 'Kore')).toBe('Kore::Привет');
    expect(buildSpeechCacheKey('Привет', ' Kore ')).toBe('Kore::Привет');
    expect(buildSpeechCacheKey('Привет', '  ')).toBe('Привет');
  });

  it('переходит на голос браузера, если звук не пришёл или опоздал', () => {
    expect(SPEECH_TIMEOUT_MS).toBe(3000);
    expect(shouldFallback({ ok: true, ms: 1800, limitMs: SPEECH_TIMEOUT_MS })).toBe(false);
    expect(shouldFallback({ ok: false, ms: 120, limitMs: SPEECH_TIMEOUT_MS })).toBe(true);
    expect(shouldFallback({ ok: true, ms: 3200, limitMs: SPEECH_TIMEOUT_MS })).toBe(true);
    expect(shouldFallback({ ok: true, ms: Number.NaN, limitMs: SPEECH_TIMEOUT_MS })).toBe(true);
  });
});

describe('проигрыватель реплик', () => {
  it('повторную фразу играет из кэша и не ходит на сервер', async () => {
    const synth = vi.fn(async (_request: SpeechSynthRequest) => wav());
    const player = createVoicePlayer({ synth });

    expect(await player.play('Здравствуйте,  это ИИ')).toBe('routerai');
    expect(await player.play('Здравствуйте, это ИИ')).toBe('routerai');

    expect(synth).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(player.isCached('Здравствуйте, это ИИ')).toBe(true);
    player.dispose();
  });

  it('уходит на голос браузера, если синтез ответил 503', async () => {
    const { speak, spoken } = stubBrowserSpeech();
    const synth = vi.fn(async (): Promise<Blob> => {
      throw new TtsError('tts_unavailable', 503);
    });
    const player = createVoicePlayer({ synth });

    expect(await player.play('Секунду, записываю…')).toBe('browser');
    expect(speak).toHaveBeenCalledTimes(1);
    expect(spoken).toEqual(['Секунду, записываю…']);
    player.dispose();
  });

  it('без синтеза и без сервера оставляет только текст', async () => {
    const synth = vi.fn(async (): Promise<Blob> => {
      throw new TtsError('tts_unavailable', 503);
    });
    const player = createVoicePlayer({ synth });

    expect(await player.play('Тишина')).toBe('silent');
    player.dispose();
  });

  it('при таймауте не ждёт сервер, а поздний ответ кладёт в кэш', async () => {
    const { speak } = stubBrowserSpeech();
    const pending: { resolve: ((blob: Blob) => void) | null } = { resolve: null };
    const synth = vi.fn(
      () =>
        new Promise<Blob>((resolve) => {
          pending.resolve = resolve;
        }),
    );
    const player = createVoicePlayer({ synth, timeoutMs: 20 });

    const started = Date.now();
    expect(await player.play('Долгая фраза')).toBe('browser');
    expect(Date.now() - started).toBeLessThan(1000);
    expect(speak).toHaveBeenCalledTimes(1);

    pending.resolve?.(wav());
    await vi.waitFor(() => expect(player.isCached('Долгая фраза')).toBe(true));
    player.dispose();
  });

  it('stop обрывает загрузку и не запускает запасной голос', async () => {
    const { speak } = stubBrowserSpeech();
    const synth = vi.fn(
      (request: SpeechSynthRequest) =>
        new Promise<Blob>((_resolve, reject) => {
          request.signal.addEventListener('abort', () => {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          });
        }),
    );
    const player = createVoicePlayer({ synth });

    const playing = player.play('Фраза, которую уже не ждём');
    player.stop();

    expect(await playing).toBe('silent');
    expect(speak).not.toHaveBeenCalled();
    player.dispose();
  });

  it('предсинтез не дублирует запрос и глотает ошибки', async () => {
    const synth = vi.fn(async (request: SpeechSynthRequest) => {
      if (request.text === 'плохо') throw new TtsError('tts_unavailable', 503);
      return wav();
    });
    const player = createVoicePlayer({ synth });

    await expect(player.prefetch(['раз', ' раз ', 'плохо', ''])).resolves.toBeUndefined();

    expect(synth).toHaveBeenCalledTimes(2);
    expect(player.isCached('раз')).toBe(true);
    expect(player.isCached('плохо')).toBe(false);
    player.dispose();
  });

  it('освобождает object-URL при выгрузке', async () => {
    const synth = vi.fn(async (_request: SpeechSynthRequest) => wav());
    const player = createVoicePlayer({ synth });

    await player.prefetch(['раз', 'два']);
    expect(createObjectURL).toHaveBeenCalledTimes(2);
    expect(player.isCached('два')).toBe(true);

    player.dispose();
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
  });
});

describe('предсинтез по жесту «Ответить»', () => {
  it('готовит приветствие, «секунду» и типовые уточнения', () => {
    expect(CALL_PREFETCH).toContain(GREETING);
    expect(CALL_PREFETCH).toContain(THINKING_SAY);
    expect(CALL_CLARIFICATIONS.length).toBeGreaterThanOrEqual(2);
    for (const text of CALL_CLARIFICATIONS) expect(CALL_PREFETCH).toContain(text);
    for (const text of CALL_PREFETCH) expect(text.length).toBeLessThanOrEqual(TTS_MAX_CHARS);
  });

  it('приветствие из предсинтеза играет без повторного запроса', async () => {
    const synth = vi.fn(async (_request: SpeechSynthRequest) => wav());
    const player = createVoicePlayer({ synth });

    await player.prefetch(CALL_PREFETCH);
    expect(synth).toHaveBeenCalledTimes(CALL_PREFETCH.length);
    expect(await player.play(GREETING)).toBe('routerai');
    expect(synth).toHaveBeenCalledTimes(CALL_PREFETCH.length);
    player.dispose();
  });
});

describe('запрос озвучки на сервер', () => {
  it('шлёт текст с cookie-сессией и возвращает WAV', async () => {
    const sent: { body: string; init: RequestInit | undefined } = { body: '', init: undefined };
    const fetchMock = vi.fn(async (_path: string, init?: RequestInit): Promise<Response> => {
      sent.body = String(init?.body ?? '');
      sent.init = init;
      return new Response(wav(64), {
        status: 200,
        headers: { 'content-type': 'audio/wav', 'x-tts-cache': 'miss' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const blob = await fetchSpeech({ text: '  Привет,  мир ', voice: 'Kore' });

    expect(blob.size).toBe(64);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/tts');
    expect(sent.init?.method).toBe('POST');
    expect(sent.init?.credentials).toBe('include');
    expect(JSON.parse(sent.body)).toEqual({ text: 'Привет, мир', voice: 'Kore' });
  });

  it('переводит отказы сервера в коды ошибок', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'tts_unavailable' }), { status: 503 })),
    );
    await expect(fetchSpeech({ text: 'Привет' })).rejects.toMatchObject({ code: 'tts_unavailable', status: 503 });

    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })));
    await expect(fetchSpeech({ text: 'Привет' })).rejects.toMatchObject({ code: 'unauthorized' });

    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 403 })));
    await expect(fetchSpeech({ text: 'Привет' })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('сеть недоступна — код tts_unavailable без статуса', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    await expect(fetchSpeech({ text: 'Привет' })).rejects.toMatchObject({ code: 'tts_unavailable', status: 0 });
  });

  it('не ходит на сервер за пустой и слишком длинной фразой', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchSpeech({ text: '   ' })).rejects.toMatchObject({ code: 'bad_request' });
    await expect(fetchSpeech({ text: 'а'.repeat(TTS_MAX_CHARS + 1) })).rejects.toMatchObject({ code: 'bad_request' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('обрывает запрос по сигналу отмены', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_path: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
            });
          }),
      ),
    );

    const request = fetchSpeech({ text: 'Привет', signal: controller.signal });
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });
});
