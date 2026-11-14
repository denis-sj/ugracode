import type { AudioInput, SpeechPort, Transcript } from '@ugra/core';

export const STUB_TRANSCRIPT = 'Принтер в кабинете 312 не печатает, мигает красный индикатор';

/** Фиксированная расшифровка для демо и тестов. */
export class StubSpeech implements SpeechPort {
  constructor(private readonly transcript: string = STUB_TRANSCRIPT) {}

  async transcribe(_audio: AudioInput): Promise<Transcript> {
    return { text: this.transcript, language: 'ru', confidence: 0.9 };
  }
}
