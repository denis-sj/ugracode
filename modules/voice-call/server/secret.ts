import { createHash, timingSafeEqual } from 'node:crypto';

export const VOICE_SECRET_HEADER = 'x-voice-secret';

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/**
 * Секрет вебхука Voximplant. Не задан в окружении → отказ всем: открытый вебхук
 * позволил бы кому угодно создавать заявки. Сравнение за постоянное время.
 */
export function voiceSecretOk(provided: unknown, expected: string | undefined): boolean {
  if (!expected || typeof provided !== 'string' || provided === '') return false;
  return timingSafeEqual(digest(provided), digest(expected));
}
