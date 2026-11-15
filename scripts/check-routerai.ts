import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import OpenAI, { toFile } from 'openai';

/**
 * Проверка озвучки RouterAI (задача 039): каталог моделей без ключа + живые запросы
 * `POST /audio/speech`. Ключ только из `.env`, в вывод не попадает.
 *
 * Запуск: `pnpm check:routerai`
 * Что видно: задержка, формат и длительность аудио на каждый голос; файлы — в `.demo/tts/` (в git не идут).
 * Если задан `POLZA_API_KEY`, каждая фраза распознаётся обратно (whisper) — так видно, какой голос
 * русский человек/ASR понимает лучше: печатаем долю совпавших слов.
 */

const DEFAULT_BASE_URL = 'https://routerai.ru/api/v1';
const MODEL = 'google/gemini-3.8-flash-lite-tts';
const TIMEOUT_MS = 30_000;
const SAMPLE_RATE = 24_000;
const PHRASE = 'Здравствуйте, диспетчерская. Ваша заявка шестьсот два принята.';
const VOICES = ['Kore', 'Charon', 'Puck', 'Aoede'];
/** Модели распознавания Polza по очереди: первая доступная ключу и побеждает. */
const ASR_MODELS = ['openai/whisper-large-v3', 'aiesa/transcribe', 'openai/whisper-1'];

const apiKey = process.env.ROUTERAI_API_KEY;
const baseURL = (process.env.ROUTERAI_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, '');

function sanitize(text: string): string {
  const secret = process.env.ROUTERAI_API_KEY;
  let result = text;
  if (secret) result = result.split(secret).join('***');
  return result.replace(/sk-[A-Za-z0-9_-]{8,}/g, '***').replace(/Bearer\s+\S+/g, 'Bearer ***');
}

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return sanitize(message).slice(0, 200);
}

function isWav(bytes: Uint8Array): boolean {
  return bytes.byteLength > 44 && Buffer.from(bytes.subarray(0, 4)).toString() === 'RIFF' && Buffer.from(bytes.subarray(8, 12)).toString() === 'WAVE';
}

/**
 * PCM 16 бит, 24 кГц, моно → WAV: браузер сам PCM не играет, нужен контейнер.
 * Если RouterAI уже вернул RIFF/WAVE, возвращаем как есть — двойной заголовок сломал бы звук.
 */
export function pcmToWav(pcm: Uint8Array, sampleRate = SAMPLE_RATE): Buffer {
  if (isWav(pcm)) return Buffer.from(pcm);
  const dataSize = pcm.byteLength;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, Buffer.from(pcm)]);
}

/** Длительность WAV в секундах — по заголовку, а не по размеру сырых сэмплов. */
function wavSeconds(wav: Buffer): number {
  const rate = wav.readUInt32LE(24) || SAMPLE_RATE;
  const channels = wav.readUInt16LE(22) || 1;
  const bits = wav.readUInt16LE(34) || 16;
  const dataSize = wav.readUInt32LE(40) || wav.byteLength - 44;
  return dataSize / (rate * channels * (bits / 8));
}

interface SpeechResult {
  audio: Buffer;
  bytes: number;
  ms: number;
  contentType: string | null;
  /** Пришёл готовый RIFF/WAVE (сейчас RouterAI отдаёт так даже при `response_format: 'pcm'`). */
  wav: boolean;
}

async function speak(text: string, voice: string, format = 'pcm'): Promise<SpeechResult> {
  if (!apiKey) throw new Error('ROUTERAI_API_KEY не задан');
  const started = Date.now();
  const response = await fetch(`${baseURL}/audio/speech`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, input: text, voice, response_format: format }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const ms = Date.now() - started;
  if (!response.ok) {
    const body = sanitize(await response.text());
    throw new Error(`HTTP ${response.status} · ${body}`);
  }
  const raw = Buffer.from(await response.arrayBuffer());
  return {
    audio: pcmToWav(raw),
    bytes: raw.byteLength,
    ms,
    contentType: response.headers.get('content-type'),
    wav: isWav(raw),
  };
}

async function catalog(): Promise<void> {
  const response = await fetch(`${baseURL}/models`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) {
    console.log(`Каталог моделей: HTTP ${response.status} — модель не проверить`);
    return;
  }
  const body = (await response.json()) as { data?: { id?: string; pricing?: unknown }[] };
  const model = body.data?.find((item) => item.id === MODEL);
  console.log(model ? `Каталог моделей (без ключа): ${MODEL} есть` : `Каталог моделей: ${MODEL} не найден`);
  if (model) console.log(`  тариф: ${JSON.stringify(model.pricing ?? '—')}`);
}

/** Доля слов исходной фразы, которые услышало распознавание: 1 — всё разборчиво. */
function intelligibility(source: string, heard: string): number {
  const norm = (value: string): string[] =>
    value
      .toLowerCase()
      .replace(/[^\p{L}\p{N} ]/gu, ' ')
      .split(/\s+/)
      .filter(Boolean);
  const expected = norm(source);
  const actual = new Set(norm(heard));
  if (expected.length === 0) return 0;
  return expected.filter((word) => actual.has(word)).length / expected.length;
}

async function transcribe(wav: Buffer): Promise<{ text: string; model: string } | null> {
  const polzaKey = process.env.POLZA_API_KEY;
  if (!polzaKey) return null;
  const client = new OpenAI({
    apiKey: polzaKey,
    baseURL: process.env.POLZA_BASE_URL ?? 'https://api.polza.ai/api/v1',
    timeout: TIMEOUT_MS,
    maxRetries: 0,
  });
  const file = await toFile(wav, 'phrase.wav', { type: 'audio/wav' });
  let lastError: unknown = null;
  for (const model of ASR_MODELS) {
    try {
      const result = await client.audio.transcriptions.create({ file, model, response_format: 'json' });
      return { text: result.text, model };
    } catch (error) {
      lastError = error;
    }
  }
  console.log(`  распознавание не удалось: ${describeError(lastError)}`);
  return null;
}

async function main(): Promise<void> {
  await catalog();
  if (!apiKey) {
    console.log('ROUTERAI_API_KEY не задан — живые запросы пропущены');
    return;
  }
  const outDir = resolve(process.cwd(), '.demo/tts');
  mkdirSync(outDir, { recursive: true });
  console.log(`\nФраза: «${PHRASE}» (${PHRASE.length} символов)`);
  console.log('Голос  | задержка | пришло | длительность | разборчивость | файл');

  const rows: { voice: string; ms: number; score: number }[] = [];
  for (const voice of VOICES) {
    try {
      const result = await speak(PHRASE, voice);
      const name = `${voice.toLowerCase()}-${createHash('sha1').update(PHRASE).digest('hex').slice(0, 6)}.wav`;
      writeFileSync(resolve(outDir, name), result.audio);
      console.log(
        `${voice.padEnd(6)} | ${String(result.ms).padStart(6)} мс | ${(result.wav ? 'wav' : 'pcm').padStart(6)} | ` +
          `${wavSeconds(result.audio).toFixed(1).padStart(9)} с | ${'     проверка   '} | .demo/tts/${name}`,
      );
      const heard = await transcribe(result.audio);
      const score = heard === null ? Number.NaN : intelligibility(PHRASE, heard.text);
      rows.push({ voice, ms: result.ms, score });
      if (heard !== null) {
        console.log(`  ${heard.model} услышал: «${heard.text}» (совпало ${Math.round(score * 100)} %)`);
      }
    } catch (error) {
      console.log(`${voice.padEnd(6)} | ошибка: ${describeError(error)}`);
    }
  }

  const mp3 = await speak(PHRASE, VOICES[0] ?? 'Kore', 'mp3').catch((error: unknown) => {
    console.log(`\nmp3-проверка: ${describeError(error)}`);
    return null;
  });
  if (mp3) console.log(`\nmp3-проверка: ответ ${mp3.contentType ?? '—'}, ${mp3.bytes} Б, ${mp3.wav ? 'это WAV, не MP3' : 'не WAV'}`);

  const bySpeed = [...rows].sort((a, b) => a.ms - b.ms);
  const byScore = rows.filter((row) => !Number.isNaN(row.score)).sort((a, b) => b.score - a.score);
  console.log(`\nБыстрее всех: ${bySpeed[0]?.voice ?? '—'} (${bySpeed[0]?.ms ?? '—'} мс)`);
  if (byScore[0]) console.log(`Понятнее всех по-русски: ${byScore[0].voice} (${Math.round(byScore[0].score * 100)} %)`);
}

await main();
