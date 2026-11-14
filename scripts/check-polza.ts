import 'dotenv/config';
import OpenAI, { toFile } from 'openai';
import { z } from 'zod';
import { toJsonSchema } from '@ugra/contracts';

const DEFAULT_BASE_URL = 'https://api.polza.ai/api/v1';
const TIMEOUT_MS = 20_000;

const apiKey = process.env.POLZA_API_KEY;
if (!apiKey) {
  console.log('POLZA_API_KEY не задан — проверка пропущена');
  process.exit(0);
}

const baseURL = process.env.POLZA_BASE_URL ?? DEFAULT_BASE_URL;
const modelMain = process.env.LLM_MODEL_MAIN ?? 'deepseek/deepseek-v4.1-flash-1017';
const embeddingsModel = process.env.EMBEDDINGS_MODEL ?? 'text-embedding-3-small';
const speechModel = process.env.SPEECH_MODEL ?? 'whisper-1';

const client = new OpenAI({ apiKey, baseURL, timeout: TIMEOUT_MS, maxRetries: 0 });
const AnswerSchema = z.object({ answer: z.string() });

function sanitize(text: string): string {
  return text
    .split(apiKey as string)
    .join('***')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, '***');
}

function describeError(error: unknown): string {
  const parts: string[] = [];
  if (typeof error === 'object' && error !== null) {
    const status = 'status' in error ? error.status : undefined;
    const code = 'code' in error ? error.code : undefined;
    if (typeof status === 'number') parts.push(`HTTP ${status}`);
    if (typeof code === 'string') parts.push(code);
  }
  const message = error instanceof Error ? error.message : String(error);
  parts.push(sanitize(message).slice(0, 160));
  return parts.filter(Boolean).join(' · ');
}

function contentOf(completion: OpenAI.Chat.ChatCompletion): string {
  const content = completion.choices[0]?.message?.content;
  return typeof content === 'string' ? content : '';
}

function pcmWavSilence(seconds: number): Buffer {
  const sampleRate = 16_000;
  const samples = Math.floor(sampleRate * seconds);
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

type Check = () => Promise<string>;

const checks: Array<{ title: string; run: Check }> = [
  {
    title: `Чат с response_format json_schema (${modelMain})`,
    run: async () => {
      const completion = await client.chat.completions.create({
        model: modelMain,
        temperature: 0,
        messages: [{ role: 'user', content: 'Верни JSON с полем answer: строка "ok".' }],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'answer',
            schema: toJsonSchema(AnswerSchema),
            strict: true,
          },
        },
      });
      const raw = contentOf(completion);
      AnswerSchema.parse(JSON.parse(raw));
      return 'работает';
    },
  },
  {
    title: `Чат без response_format (${modelMain})`,
    run: async () => {
      const completion = await client.chat.completions.create({
        model: modelMain,
        temperature: 0,
        messages: [{ role: 'user', content: 'Ответь одним словом: ok' }],
      });
      const raw = contentOf(completion);
      if (raw.length === 0) {
        throw new Error('пустой ответ');
      }
      return 'работает';
    },
  },
  {
    title: `Эмбеддинги (${embeddingsModel})`,
    run: async () => {
      const response = await client.embeddings.create({
        model: embeddingsModel,
        input: ['проверка провайдера'],
      });
      const vector = response.data[0]?.embedding;
      if (!vector || vector.length === 0) {
        throw new Error('пустой вектор');
      }
      return 'работает';
    },
  },
  {
    title: `Распознавание речи (${speechModel})`,
    run: async () => {
      const file = await toFile(pcmWavSilence(0.3), 'check.wav', { type: 'audio/wav' });
      const response = await client.audio.transcriptions.create({
        file,
        model: speechModel,
        response_format: 'json',
      });
      if (typeof response.text !== 'string') {
        throw new Error('нет поля text в ответе');
      }
      return 'работает';
    },
  },
];

let failed = 0;
for (const [index, check] of checks.entries()) {
  const label = `${index + 1}. ${check.title}`;
  const startedAt = Date.now();
  try {
    const status = await check.run();
    console.log(`${label}: ${status} (${Date.now() - startedAt} мс)`);
  } catch (error) {
    failed += 1;
    console.log(`${label}: не работает: ${describeError(error)}`);
  }
}

console.log(failed === 0 ? 'Итог: все проверки прошли' : `Итог: ошибок — ${failed}`);
process.exitCode = failed === 0 ? 0 : 1;
