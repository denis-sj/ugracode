import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { LlmMessage } from '@ugra/contracts';
import type { LlmPort } from '@ugra/core';
import type { CallLine, ReplySource } from './calls';

export const DIALOG_PROMPT_ID = 'modules/voice-call/prompts/dialog.v1.md';

/** Сколько ждём модель: дольше — пауза в трубке слишком заметна, говорим запасную фразу. */
export const DEFAULT_TURN_TIMEOUT_MS = 6000;
/** Больше трёх реплик заявителя не слушаем: заявка собирается, остальное уточнит диспетчер. */
export const MAX_CALLER_LINES = 3;
/** Лимит длительности звонка. */
export const MAX_CALL_MS = 90_000;
export const MAX_SAY_CHARS = 200;

export const FALLBACK_QUESTION = 'Уточните, пожалуйста, кабинет и как с вами связаться.';
export const SILENCE_QUESTION = 'Не расслышала вас. Повторите, пожалуйста, что случилось и в каком кабинете.';
export const LIMIT_FAREWELL = 'Спасибо, этого достаточно. Заявку передаю диспетчеру.';
export const EMERGENCY_SAY = 'Похоже на аварию. Передаю дежурному инженеру прямо сейчас.';

/** Ответ модели на диалоговом шаге. */
export const DialogReply = z.object({
  say: z.string().min(1),
  done: z.boolean(),
  emergency: z.boolean(),
});
export type DialogReply = z.infer<typeof DialogReply>;

export interface TurnDecision extends DialogReply {
  source: ReplySource;
  /** Сколько заняла модель, мс; 0 — модель не вызывали. */
  ms: number;
}

/**
 * Признаки аварии по словам заявителя — второй сигнал рядом с мнением модели
 * (агент предлагает, код проверяет). Полный разбор аварии делает модуль `emergency` в пайплайне.
 */
// `\b` в JS не видит границ кириллических слов, поэтому границы — через просмотр назад и вперёд.
const EMERGENCY_PATTERNS: readonly RegExp[] = [
  /(?<![а-яё])дым(?:а|у|ом)?(?![а-яё])/i,
  /задымлен/i,
  /искрит/i,
  /(?<![а-яё])гар(ь|ью|и)(?![а-яё])/i,
  /горел/i,
  /пожар/i,
  /(?<![а-яё])горит(?![а-яё])/i,
  /(залил|затопил|течёт|течет).{0,30}(сервер|щит|оборудован)/i,
  /(весь|всего|всём|всем)\s+(этаж|корпус)/i,
];

export function hasEmergencySign(text: string): boolean {
  return EMERGENCY_PATTERNS.some((pattern) => pattern.test(text));
}

/** Фраза для синтеза речи: без markdown и переносов, не длиннее лимита. */
export function speakable(text: string): string {
  const plain = text
    .replace(/[*_`#>«»"]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length <= MAX_SAY_CHARS) return plain;
  const cut = plain.slice(0, MAX_SAY_CHARS);
  const sentenceEnd = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
  return sentenceEnd > 40 ? cut.slice(0, sentenceEnd + 1) : `${cut.slice(0, MAX_SAY_CHARS - 1).trimEnd()}…`;
}

/** JSON из ответа модели: допускаем обёртку ```json и текст вокруг объекта. */
export function parseReply(content: string | null): DialogReply | null {
  if (!content) return null;
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = DialogReply.safeParse(JSON.parse(content.slice(start, end + 1)));
    if (!parsed.success) return null;
    const say = speakable(parsed.data.say);
    return say === '' ? null : { ...parsed.data, say };
  } catch {
    return null;
  }
}

let cachedPrompt: string | null = null;

function systemPrompt(): string {
  cachedPrompt ??= readFileSync(new URL('../prompts/dialog.v1.md', import.meta.url), 'utf8');
  return cachedPrompt;
}

/** История звонка → сообщения модели: заявитель — `user`, ИИ — `assistant` в том же JSON-формате. */
export function dialogMessages(lines: readonly CallLine[]): LlmMessage[] {
  const history: LlmMessage[] = lines.map((line) =>
    line.speaker === 'caller'
      ? { role: 'user', content: line.text }
      : { role: 'assistant', content: JSON.stringify({ say: line.text, done: false, emergency: false }) },
  );
  const callerLines = lines.filter((line) => line.speaker === 'caller').length;
  return [
    { role: 'system', content: systemPrompt() },
    {
      role: 'system',
      content: `Реплика заявителя ${callerLines} из ${MAX_CALLER_LINES}. На последней реплике заканчивай разговор (done: true).`,
    },
    ...history,
  ];
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`модель не ответила за ${ms} мс`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export interface DialogInput {
  llm: LlmPort;
  /** История звонка, последняя строка — свежая реплика заявителя. */
  lines: readonly CallLine[];
  /** Сколько длится звонок, мс. */
  elapsedMs: number;
  timeoutMs?: number;
  now?: () => number;
}

/**
 * Диалоговый шаг: что сказать заявителю в ответ на его реплику.
 *
 * Порядок проверок: тишина → авария по словам (код) → лимит реплик и времени (код) → модель.
 * Модель не ответила за `timeoutMs`, упала или вернула не JSON → запасной вопрос: звонок не обрывается.
 */
export async function dialogTurn(input: DialogInput): Promise<TurnDecision> {
  const now = input.now ?? Date.now;
  const last = input.lines.at(-1);
  const lastText = last?.speaker === 'caller' ? last.text.trim() : '';
  const callerLines = input.lines.filter((line) => line.speaker === 'caller').length;
  const atLimit = callerLines >= MAX_CALLER_LINES || input.elapsedMs >= MAX_CALL_MS;

  if (lastText === '') {
    return atLimit
      ? { say: LIMIT_FAREWELL, done: true, emergency: false, source: 'rule', ms: 0 }
      : { say: SILENCE_QUESTION, done: false, emergency: false, source: 'rule', ms: 0 };
  }
  if (hasEmergencySign(lastText)) {
    return { say: EMERGENCY_SAY, done: true, emergency: true, source: 'rule', ms: 0 };
  }
  if (atLimit) {
    return { say: LIMIT_FAREWELL, done: true, emergency: false, source: 'rule', ms: 0 };
  }

  const started = now();
  try {
    const response = await withTimeout(
      input.llm.chat({ messages: dialogMessages(input.lines), tools: [], temperature: 0 }),
      input.timeoutMs ?? DEFAULT_TURN_TIMEOUT_MS,
    );
    const ms = now() - started;
    const reply = parseReply(response.message.content);
    if (!reply) return { say: FALLBACK_QUESTION, done: false, emergency: false, source: 'fallback', ms };
    if (reply.emergency) return { say: EMERGENCY_SAY, done: true, emergency: true, source: 'ai', ms };
    return { ...reply, source: 'ai', ms };
  } catch {
    return { say: FALLBACK_QUESTION, done: false, emergency: false, source: 'fallback', ms: now() - started };
  }
}
