/**
 * Клиент озвучки ИИ-оператора: серверный синтез `POST /api/tts` (RouterAI → WAV), кэш готовых фраз
 * и запасной голос браузера (`speechSynthesis`), если сервер молчит дольше трёх секунд.
 *
 * Правила, которые здесь зашиты:
 * - текст реплики показывается сразу, звук догоняет по готовности: `play` ничего не блокирует в интерфейсе;
 * - iOS/Safari включает звук только после жеста, поэтому `unlock()` вызывается в обработчике нажатия;
 * - повторная фраза берётся из кэша object-URL и не стоит ни запроса, ни денег.
 */

import { pickRussianVoice } from './call-flow';

/** Путь эндпоинта озвучки: Vite проксирует `/api` на сервер. */
export const TTS_PATH = '/api/tts';
/** Серверный лимит длины фразы: длиннее — 400, поэтому проверяем до запроса. */
export const TTS_MAX_CHARS = 400;
/** Сколько ждём серверный синтез, прежде чем сказать голосом браузера. */
export const SPEECH_TIMEOUT_MS = 3000;
/** Страховка на проигрывание: дольше этого один ответ не звучит. */
const MAX_PLAY_MS = 30_000;
/** Зависший запрос не держим дольше: иначе повтор фразы будет ждать тот же «висяк». */
const REQUEST_TTL_MS = 8000;
/** Столько фраз держим в кэше: дальше освобождаем самые старые object-URL. */
const MAX_CACHE_ENTRIES = 24;

/** Откуда взялся звук: серверный синтез, голос браузера или тишина. */
export type SpeechSource = 'routerai' | 'browser' | 'silent';

/** Машинный код ошибки озвучки: по нему решаем, молчать или пробовать голос браузера. */
export type TtsErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'tts_unavailable'
  | 'empty_audio'
  | 'http_error';

/** Ошибка запроса озвучки с кодом и HTTP-статусом (`0` — ответа не было). */
export class TtsError extends Error {
  readonly code: TtsErrorCode;
  readonly status: number;

  constructor(code: TtsErrorCode, status: number) {
    super(`озвучка недоступна: ${code} (${status})`);
    this.name = 'TtsError';
    this.code = code;
    this.status = status;
  }
}

export interface FetchSpeechInput {
  text: string;
  /** Голос Gemini TTS; без него сервер берёт голос по умолчанию. */
  voice?: string;
  signal?: AbortSignal;
}

/** `AbortError` не подменяем своей ошибкой: отмена — не сбой синтеза. */
function isAbortError(reason: unknown): boolean {
  return typeof reason === 'object' && reason !== null && (reason as { name?: unknown }).name === 'AbortError';
}

function codeForStatus(status: number): TtsErrorCode {
  switch (status) {
    case 400:
      return 'bad_request';
    case 401:
      return 'unauthorized';
    case 403:
      return 'forbidden';
    case 503:
      return 'tts_unavailable';
    default:
      return 'http_error';
  }
}

/** Код из тела ошибки (`{error:'tts_unavailable'}`), если он нам известен. */
async function codeFromBody(response: Response, fallback: TtsErrorCode): Promise<TtsErrorCode> {
  if (fallback !== 'http_error') return fallback;
  try {
    const payload: unknown = await response.json();
    const raw = typeof payload === 'object' && payload !== null ? (payload as { error?: unknown }).error : null;
    if (raw === 'tts_unavailable' || raw === 'bad_request' || raw === 'unauthorized' || raw === 'forbidden') {
      return raw;
    }
  } catch {
    /* тело не JSON — остаётся код по статусу */
  }
  return fallback;
}

/**
 * Синтез одной фразы: `POST /api/tts` с cookie-сессией, ответ — WAV.
 *
 * Бросает `TtsError` с кодом: `400` — пусто или длинно, `401/403` — нет сессии или прав,
 * `503` — синтез недоступен (нет ключа, сеть, таймаут).
 */
export async function fetchSpeech({ text, voice, signal }: FetchSpeechInput): Promise<Blob> {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean === '' || clean.length > TTS_MAX_CHARS) throw new TtsError('bad_request', 400);

  const body: { text: string; voice?: string } = { text: clean };
  const voiceName = voice?.trim();
  if (voiceName) body.voice = voiceName;

  let response: Response;
  try {
    response = await fetch(TTS_PATH, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
  } catch (reason) {
    if (isAbortError(reason)) throw reason;
    throw new TtsError('tts_unavailable', 0);
  }

  if (!response.ok) {
    throw new TtsError(await codeFromBody(response, codeForStatus(response.status)), response.status);
  }

  const type = response.headers.get('content-type') ?? '';
  if (type !== '' && !type.startsWith('audio/')) throw new TtsError('http_error', response.status);

  const blob = await response.blob();
  if (blob.size === 0) throw new TtsError('empty_audio', response.status);
  return blob;
}

/** Ключ кэша: фраза без лишних пробелов плюс голос — одинаковый текст и голос дают один и тот же звук. */
export function buildSpeechCacheKey(text: string, voice?: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  const voiceName = voice?.trim() ?? '';
  return voiceName === '' ? clean : `${voiceName}::${clean}`;
}

export interface FallbackInput {
  /** Пришёл ли звук с сервера. */
  ok: boolean;
  /** Сколько миллисекунд ждали. */
  ms: number;
  /** Терпение разговора: дольше — уже неприлично. */
  limitMs: number;
}

/** Пора ли переходить на голос браузера: не пришло, пришло поздно или время неизвестно. */
export function shouldFallback({ ok, ms, limitMs }: FallbackInput): boolean {
  if (!ok) return true;
  if (!Number.isFinite(ms)) return true;
  return ms > limitMs;
}

export interface SpeechSynthRequest {
  text: string;
  voice?: string;
  signal: AbortSignal;
}

/** Синтез фразы в аудио: по умолчанию серверный `fetchSpeech`, в тестах — заглушка. */
export type SpeechSynth = (request: SpeechSynthRequest) => Promise<Blob>;

export interface VoicePlayerOptions {
  /** Замена серверного синтеза (тесты, демо без сети). */
  synth?: SpeechSynth;
  /** Голос Gemini TTS; без него — серверный по умолчанию. */
  voice?: string;
  /** Терпение к серверу, мс. По умолчанию `SPEECH_TIMEOUT_MS`. */
  timeoutMs?: number;
}

/** Проигрыватель реплик ИИ: один `Audio`, кэш фраз, запасной `speechSynthesis`. */
export interface VoicePlayer {
  /** Разбудить звук жестом пользователя (iOS): тихая фраза синтеза и пустой WAV в `Audio`. */
  unlock(): void;
  /** Синтезировать фразы заранее, параллельно; ошибки не пробрасываются. */
  prefetch(texts: readonly string[]): Promise<void>;
  /** Сказать фразу: серверный звук, иначе голос браузера, иначе тишина. */
  play(text: string): Promise<SpeechSource>;
  /** Оборвать звук и незавершённые загрузки; кэш остаётся для повторных фраз. */
  stop(): void;
  /** Есть ли уже готовый звук этой фразы. */
  isCached(text: string): boolean;
  /** Полная выгрузка: остановить звук и освободить все object-URL. */
  dispose(): void;
}

/** Обёртка над `Audio`: в тестах и на сервере его может не быть. */
function audioConstructor(): typeof Audio | null {
  const scope = globalThis as { Audio?: typeof Audio };
  return scope.Audio ?? null;
}

/** Синтез браузера: в части окружений (и в тестах) его нет. */
function browserSynth(): SpeechSynthesis | null {
  const scope = globalThis as { speechSynthesis?: SpeechSynthesis };
  return scope.speechSynthesis ?? null;
}

function browserUtterance(): typeof SpeechSynthesisUtterance | null {
  const scope = globalThis as { SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance };
  return scope.SpeechSynthesisUtterance ?? null;
}

function now(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

/** Гонка промиса с таймером: не ждём дольше `ms`, вместо результата — `null`. */
function withinDeadline<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve(null);
    }, ms);
    void promise.then((value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    });
  });
}

/**
 * Тишина на 20 мс в формате сервера (WAV, 16 бит, моно, 24 кГц).
 * Нужна только чтобы «разбудить» `Audio` внутри жеста — дальше он играет без спроса.
 */
function silentWav(): Blob {
  const frames = 480; // 20 мс при 24 кГц
  const buffer = new ArrayBuffer(44 + frames * 2);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + frames * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // размер блока fmt
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // моно
  view.setUint32(24, 24_000, true); // частота дискретизации
  view.setUint32(28, 48_000, true); // байт в секунду
  view.setUint16(32, 2, true); // выравнивание блока
  view.setUint16(34, 16, true); // бит на сэмпл
  ascii(36, 'data');
  view.setUint32(40, frames * 2, true);
  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * Создать проигрыватель реплик ИИ.
 *
 * Один экземпляр на звонок: он держит `Audio`, кэш object-URL и общий набор запросов синтеза
 * (предсинтез и `play` одной фразы не дублируют запрос).
 */
export function createVoicePlayer(options: VoicePlayerOptions = {}): VoicePlayer {
  const synth: SpeechSynth = options.synth ?? fetchSpeech;
  const timeoutMs = options.timeoutMs ?? SPEECH_TIMEOUT_MS;
  const voice = options.voice;
  /** Ключ фразы → object-URL готового WAV. */
  const urls = new Map<string, string>();
  /** Ключ фразы → общий запрос синтеза, чтобы предсинтез и `play` не дублировались. */
  const inflight = new Map<string, Promise<Blob | null>>();
  const controllers = new Set<AbortController>();

  let audio: HTMLAudioElement | null = null;
  /** Текущее проигрывание: `stop` гасит его через этот колбэк. */
  let finishPlay: ((ok: boolean) => void) | null = null;
  /** Номер попытки: после `stop`/нового `play` старые ответы никого не касаются. */
  let session = 0;
  let unlocked = false;
  let disposed = false;

  const ensureAudio = (): HTMLAudioElement | null => {
    if (audio) return audio;
    const Ctor = audioConstructor();
    if (!Ctor) return null;
    try {
      audio = new Ctor();
      return audio;
    } catch {
      return null;
    }
  };

  const revoke = (key: string): void => {
    const url = urls.get(key);
    if (!url) return;
    urls.delete(key);
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* URL уже освобождён */
    }
  };

  /** Положить готовый WAV в кэш; самые старые фразы освобождаем, чтобы память не росла. */
  const store = (key: string, blob: Blob): void => {
    if (disposed || urls.has(key)) return;
    const url = URL.createObjectURL(blob);
    urls.set(key, url);
    while (urls.size > MAX_CACHE_ENTRIES) {
      const oldest = urls.keys().next();
      if (oldest.done) break;
      revoke(oldest.value);
    }
  };

  const stopAudio = (): void => {
    finishPlay?.(false);
    finishPlay = null;
    const element = audio;
    if (!element) return;
    try {
      element.pause();
      element.removeAttribute('src');
      element.load();
    } catch {
      /* элемент уже без источника */
    }
  };

  const cancelBrowserSpeech = (): void => {
    try {
      browserSynth()?.cancel();
    } catch {
      /* синтез браузера недоступен */
    }
  };

  const interruptOutput = (): void => {
    stopAudio();
    cancelBrowserSpeech();
  };

  /** Один запрос синтеза на фразу: предсинтез и `play` делят его между собой. */
  const startRequest = (key: string, text: string): Promise<Blob | null> => {
    const existing = inflight.get(key);
    if (existing) return existing;

    const controller = new AbortController();
    const guard = setTimeout(() => controller.abort(), REQUEST_TTL_MS);
    controllers.add(controller);
    const pending: Promise<Blob | null> = synth({ text, voice, signal: controller.signal })
      .then((blob) => {
        if (blob.size > 0) store(key, blob);
        return blob;
      })
      .catch(() => null)
      .finally(() => {
        clearTimeout(guard);
        controllers.delete(controller);
        if (inflight.get(key) === pending) inflight.delete(key);
      });

    inflight.set(key, pending);
    return pending;
  };

  /** Проиграть готовый object-URL; `false` — браузер не дал звук (тогда сработает запасной путь). */
  const playUrl = (url: string): Promise<boolean> =>
    new Promise((resolve) => {
      const element = ensureAudio();
      if (!element) {
        resolve(false);
        return;
      }

      let settled = false;
      const state: { timer?: ReturnType<typeof setTimeout> } = {};
      let stopper: ((ok: boolean) => void) | null = null;

      const settle = (ok: boolean): void => {
        if (settled) return;
        settled = true;
        element.removeEventListener('ended', onEnded);
        element.removeEventListener('error', onError);
        if (state.timer !== undefined) clearTimeout(state.timer);
        if (finishPlay === stopper) finishPlay = null;
        resolve(ok);
      };
      const onEnded = (): void => settle(true);
      const onError = (): void => settle(false);

      stopper = (ok: boolean): void => settle(ok);
      finishPlay = stopper;
      element.addEventListener('ended', onEnded);
      element.addEventListener('error', onError);

      try {
        element.src = url;
        const started = element.play();
        if (started && typeof started.catch === 'function') started.catch(() => settle(false));
      } catch {
        settle(false);
        return;
      }
      // Если `ended` не придёт (вкладка в фоне), разговор не замирает.
      state.timer = setTimeout(() => settle(true), MAX_PLAY_MS);
    });

  /** Запасной путь: голос браузера. Нет синтеза — молчим, текст уже на экране. */
  const speakInBrowser = async (text: string): Promise<SpeechSource> => {
    const synthApi = browserSynth();
    const Utterance = browserUtterance();
    if (!synthApi || !Utterance) return 'silent';

    return new Promise<SpeechSource>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let finished = false;
      const finish = (): void => {
        if (finished) return;
        finished = true;
        if (timer !== undefined) clearTimeout(timer);
        resolve('browser');
      };
      try {
        const utterance = new Utterance(text);
        utterance.lang = 'ru-RU';
        utterance.rate = 1;
        utterance.pitch = 1;
        const voices = synthApi.getVoices();
        const picked = pickRussianVoice(voices);
        if (picked) {
          const match = voices.find((item) => item.lang === picked.lang && item.name === picked.name);
          if (match) utterance.voice = match;
        }
        utterance.onend = finish;
        utterance.onerror = finish;
        // Страховка: если onend не придёт (вкладка в фоне), разговор не замирает.
        timer = setTimeout(finish, Math.max(4000, text.length * 120));
        synthApi.speak(utterance);
      } catch {
        resolve('silent');
      }
    });
  };

  const play = async (text: string): Promise<SpeechSource> => {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (clean === '') return 'silent';

    const id = (session += 1);
    interruptOutput();

    const key = buildSpeechCacheKey(clean, voice);
    const cached = urls.get(key);
    if (cached) {
      const played = await playUrl(cached);
      if (id !== session) return 'silent';
      return played ? 'routerai' : speakInBrowser(clean);
    }

    const started = now();
    // Ждём сервер не дольше таймаута; сам запрос живёт дальше и прогреет кэш.
    await withinDeadline(startRequest(key, clean), timeoutMs);
    const elapsed = now() - started;
    if (id !== session) return 'silent';

    // Фраза могла прийти и после таймаута — тогда она уже в кэше для следующего раза.
    const ready = urls.get(key);
    if (ready && !shouldFallback({ ok: true, ms: elapsed, limitMs: timeoutMs })) {
      const played = await playUrl(ready);
      if (id !== session) return 'silent';
      if (played) return 'routerai';
    }
    return speakInBrowser(clean);
  };

  return {
    unlock: (): void => {
      const synthApi = browserSynth();
      const Utterance = browserUtterance();
      if (synthApi && Utterance) {
        try {
          const warm = new Utterance(' ');
          warm.volume = 0;
          warm.lang = 'ru-RU';
          synthApi.speak(warm);
        } catch {
          /* синтез браузера недоступен — разговор пойдёт субтитрами */
        }
      }

      const element = ensureAudio();
      if (!element || unlocked) return;
      unlocked = true;
      let url = '';
      try {
        url = URL.createObjectURL(silentWav());
        element.src = url;
        const started = element.play();
        const reset = (): void => {
          try {
            element.pause();
            element.removeAttribute('src');
            URL.revokeObjectURL(url);
          } catch {
            /* элемент уже без источника */
          }
        };
        if (started && typeof started.then === 'function') void started.then(reset).catch(reset);
        else reset();
      } catch {
        if (url !== '') {
          try {
            URL.revokeObjectURL(url);
          } catch {
            /* URL уже освобождён */
          }
        }
      }
    },

    prefetch: async (texts: readonly string[]): Promise<void> => {
      const jobs: Promise<Blob | null>[] = [];
      for (const raw of texts) {
        const clean = raw.replace(/\s+/g, ' ').trim();
        if (clean === '') continue;
        const key = buildSpeechCacheKey(clean, voice);
        if (urls.has(key)) continue;
        jobs.push(withinDeadline(startRequest(key, clean), timeoutMs));
      }
      await Promise.allSettled(jobs);
    },

    play,

    stop: (): void => {
      session += 1;
      interruptOutput();
      for (const controller of controllers) controller.abort();
      controllers.clear();
    },

    isCached: (text: string): boolean => urls.has(buildSpeechCacheKey(text, voice)),

    dispose: (): void => {
      session += 1;
      disposed = true;
      interruptOutput();
      for (const controller of controllers) controller.abort();
      controllers.clear();
      inflight.clear();
      for (const key of [...urls.keys()]) revoke(key);
      audio = null;
    },
  };
}
