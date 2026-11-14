import OpenAI, { toFile } from 'openai';
import type { AudioInput, SpeechPort, Transcript } from '@ugra/core';
import { DEFAULT_POLZA_BASE_URL } from '../llm/polza';

export interface PolzaSpeechOptions {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  timeoutMs?: number;
}

/** Распознавание речи через Polza (`audio.transcriptions`). */
export class PolzaSpeech implements SpeechPort {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(options: PolzaSpeechOptions = {}) {
    const apiKey = options.apiKey ?? process.env.POLZA_API_KEY;
    if (!apiKey) {
      throw new Error('POLZA_API_KEY не задан: распознавание речи Polza недоступно');
    }
    this.client = new OpenAI({
      apiKey,
      baseURL: options.baseURL ?? process.env.POLZA_BASE_URL ?? DEFAULT_POLZA_BASE_URL,
      timeout: options.timeoutMs ?? 20_000,
      maxRetries: 0,
    });
    this.model = options.model ?? process.env.SPEECH_MODEL ?? 'whisper-1';
  }

  async transcribe(audio: AudioInput): Promise<Transcript> {
    const file = await toFile(Buffer.from(audio.data, 'base64'), fileName(audio.mimeType), {
      type: audio.mimeType,
    });
    const response = await this.client.audio.transcriptions.create({
      file,
      model: this.model,
      response_format: 'json',
    });
    return { text: response.text, language: 'ru' };
  }
}

function fileName(mimeType: string): string {
  if (mimeType.includes('wav')) return 'audio.wav';
  if (mimeType.includes('mp3')) return 'audio.mp3';
  if (mimeType.includes('ogg')) return 'audio.ogg';
  if (mimeType.includes('webm')) return 'audio.webm';
  return 'audio.bin';
}
