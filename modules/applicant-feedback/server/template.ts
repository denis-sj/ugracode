import type { PriorityLevel, PriorityVerdict } from '@ugra/contracts';
import type { ReferenceData } from '@ugra/core';

/**
 * Шаблоны сообщений заявителю. Всё содержимое берётся из данных заявки
 * (номер, приоритет, сроки) — ничего не выдумываем. Модель, если она доступна,
 * может только переписать готовый шаблон; числа в нём обязаны остаться прежними.
 */

/** Подписи на случай, если справочник `priority` не загружен (тесты, частичный сид). */
const PRIORITY_LABELS: Record<PriorityLevel, string> = {
  low: 'Низкий',
  medium: 'Средний',
  high: 'Высокий',
  critical: 'Критический',
  emergency: 'Авария',
};

const NEXT_STEP = 'Диспетчер проверит заявку и назначит исполнителя.';
const REPEAT_HINT = 'Если проблема повторится, ответьте в этом чате.';

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function timeOf(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Разница календарных дней между локальными датами: 0 — сегодня, 1 — завтра. */
function calendarDayDiff(from: Date, to: Date): number {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  return Math.round((end - start) / 86_400_000);
}

function parseDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Срок понятным языком: «сегодня до 18:00», «завтра до 09:00», «18.11 до 12:00». */
export function formatDue(iso: string | null | undefined, now: Date): string | null {
  const date = parseDate(iso);
  if (!date) return null;
  const time = timeOf(date);
  const diff = calendarDayDiff(now, date);
  if (diff === 0) return `сегодня до ${time}`;
  if (diff === 1) return `завтра до ${time}`;
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)} до ${time}`;
}

/** Сколько минут осталось до срока реакции: отрицательное и нулевое не показываем. */
export function reactionMinutes(iso: string | null | undefined, now: Date): number | null {
  const date = parseDate(iso);
  if (!date) return null;
  const minutes = Math.round((date.getTime() - now.getTime()) / 60_000);
  return minutes > 0 ? minutes : null;
}

/** Подпись приоритета из справочника `priority`; неизвестный код — как есть. */
export function priorityLabel(
  data: ReferenceData,
  level: PriorityLevel | null | undefined,
): string | null {
  if (!level) return null;
  const fromDictionary = data.dictionaries.find(
    (item) => item.dictionary === 'priority' && item.code === level,
  )?.label;
  return fromDictionary ?? PRIORITY_LABELS[level] ?? String(level);
}

export interface ReplyTemplateInput {
  number: string | null;
  priority: Pick<PriorityVerdict, 'value' | 'reactDueAt' | 'slaDueAt'> | null;
  priorityLabel: string | null;
  now: Date;
}

/**
 * Автоматическое сообщение после разбора: «Заявка № … принята, приоритет …, срок …»
 * и что дальше. Нет приоритета или срока — фраза просто не добавляется.
 */
export function buildReplyTemplate(input: ReplyTemplateInput): string {
  const parts = [input.number ? `Заявка № ${input.number} принята` : 'Заявка принята'];
  if (input.priorityLabel) parts.push(`приоритет «${input.priorityLabel}»`);
  const due = formatDue(input.priority?.slaDueAt, input.now);
  if (due) parts.push(`срок решения — ${due}`);

  const minutes = reactionMinutes(input.priority?.reactDueAt, input.now);
  const next = minutes ? `Свяжемся с вами в течение ${minutes} мин.` : NEXT_STEP;
  return `${parts.join(', ')}. ${next}`;
}

export interface ConfirmationInput {
  number: string;
  assigneeName: string | null;
  priorityLabel: string | null;
  slaDueAt: string | null;
  now: Date;
}

/** Сообщение после подтверждения диспетчером: номер, исполнитель, срок решения. */
export function buildConfirmation(input: ConfirmationInput): string {
  const parts = [`Заявка № ${input.number} принята`];
  if (input.priorityLabel) parts.push(`приоритет «${input.priorityLabel}»`);
  const due = formatDue(input.slaDueAt, input.now);
  if (due) parts.push(`срок решения — ${due}`);

  const who = input.assigneeName
    ? `Исполнитель — ${input.assigneeName}.`
    : 'Заявка передана в работу.';
  return `${parts.join(', ')}. ${who} ${REPEAT_HINT}`;
}

const NUMBER = /\d+(?:[.,]\d+)?/g;

function normalizeNumber(token: string): string {
  const parsed = Number(token.replace(',', '.'));
  return Number.isFinite(parsed) ? String(parsed) : token;
}

/**
 * Защита от выдуманных цифр: каждое число в тексте модели обязано быть в шаблоне.
 * Не прошло — остаётся шаблон (он собран только из данных заявки).
 */
export function hasUnknownNumbers(text: string, source: string): boolean {
  const allowed = new Set((source.match(NUMBER) ?? []).map(normalizeNumber));
  for (const token of text.match(NUMBER) ?? []) {
    if (!allowed.has(normalizeNumber(token))) return true;
  }
  return false;
}
