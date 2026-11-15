import { randomUUID } from 'node:crypto';
import type { AppealMessage, Ticket, TicketField } from '@ugra/contracts';
import type { DraftPatch, KernelStore, StepContext } from '@ugra/core';
import { findField, missingFields, settingNumber } from '@ugra/core';
import { aiQuestionsOf, buildQuestion, orderByPlan, planFromHistory, questionCard } from './question';

export const CLARIFY_STEP_ID = 'clarify.missing';
/** Ключ данных модуля в `draft.ext`. */
export const CLARIFY_EXT_KEY = 'clarify-chat';
/** Сколько раз спрашиваем одно и то же поле, если ответ не помог (настройка `maxClarifyRounds`). */
export const DEFAULT_MAX_ROUNDS = 2;

function traceKinds(trace: readonly unknown[]): string[] {
  return trace.map((entry) => {
    if (typeof entry === 'object' && entry !== null && 'kind' in entry) {
      return String((entry as { kind: unknown }).kind);
    }
    return '';
  });
}

/** Поля, на которые заявитель ответил «Не знаю»: повторно их не спрашиваем. */
function noAnswerKeys(fields: Record<string, { trace?: readonly unknown[] }>): Set<string> {
  const keys = new Set<string>();
  for (const [key, field] of Object.entries(fields)) {
    if (traceKinds(field.trace ?? []).includes('no_answer')) keys.add(key);
  }
  return keys;
}

/** Значения полей из заявки: повторный разбор с `validate` начинается с пустого черновика. */
function ticketValues(fields: readonly TicketField[]): Record<string, { value: unknown }> {
  const values: Record<string, { value: unknown }> = {};
  for (const field of fields) values[field.fieldKey] = { value: field.value };
  return values;
}

function ticketTraces(fields: readonly TicketField[]): Record<string, { trace: readonly unknown[] }> {
  const traces: Record<string, { trace: readonly unknown[] }> = {};
  for (const field of fields) traces[field.fieldKey] = { trace: field.trace };
  return traces;
}

/** Заявка обращения: шаг идёт в `validate`, заявка уже создана черновиком. */
async function ticketOf(db: KernelStore, appealId: string): Promise<Ticket | null> {
  const tickets = await db.listTickets({ limit: 1000 });
  return tickets.find((ticket) => ticket.appealId === appealId) ?? null;
}

/** Сколько раз поле уже спрашивали в этом чате. */
export function askedRounds(messages: readonly AppealMessage[], fieldKey: string): number {
  return messages.filter((message) => message.kind === 'question_card' && message.fieldKey === fieldKey).length;
}

/** Последнее сообщение по полю — вопрос, а ответа ещё нет: второй раз не спрашиваем. */
function awaitingAnswer(messages: readonly AppealMessage[], fieldKey: string): boolean {
  const own = messages.filter(
    (message) => message.fieldKey === fieldKey && (message.kind === 'question_card' || message.kind === 'answer'),
  );
  return own.at(-1)?.kind === 'question_card';
}

/**
 * Шаг `clarify.missing`: обязательные поля, которых не хватает, → одна карточка-вопрос.
 *
 * Недостающие считает код (`missingFields`), а не модель. Учитываем и черновик, и уже
 * сохранённые поля заявки: повторный разбор с `validate` стартует с пустого черновика,
 * но отвеченные поля из заявки терять нельзя. Вопрос — по первому полю, которое ещё
 * не спрашивали `maxClarifyRounds` раз; на «Не знаю» поле уходит диспетчеру и больше не спрашивается.
 */
export async function clarifyMissing(ctx: StepContext): Promise<DraftPatch | void> {
  const db = ctx.db;
  const ticket = db ? await ticketOf(db, ctx.appeal.id) : null;
  const stored = db && ticket ? await db.getTicketFields(ticket.id) : [];
  const values = { ...ticketValues(stored), ...ctx.draft.fields };
  const missing = missingFields(ctx.data.fields, values);
  if (missing.length === 0) return { missing: [] };

  const silent = noAnswerKeys({ ...ticketTraces(stored), ...ctx.draft.fields });
  const candidates = missing.filter((field) => !silent.has(field.key));
  if (candidates.length === 0) return { missing };

  // Без хранилища вопрос некуда записать: карточку не создаём, но список недостающих отдаём.
  if (!db) return { missing };

  let history: AppealMessage[] = [];
  try {
    history = await db.listAppealMessages(ctx.appeal.id);
  } catch {
    history = [];
  }

  // Порядок и формулировки — модели: из текущего разбора или из плана в первой карточке.
  const fresh = aiQuestionsOf(ctx.draft.ext);
  const plan = fresh.length > 0 ? fresh : planFromHistory(history);
  const ordered = orderByPlan(candidates, plan).map((field) =>
    buildQuestion(field, findField(ctx.data, field.key), ctx.data, plan),
  );

  const maxRounds = settingNumber(ctx.data, 'maxClarifyRounds', DEFAULT_MAX_ROUNDS);
  const question = ordered.find(
    (field) => askedRounds(history, field.key) < maxRounds && !awaitingAnswer(history, field.key),
  );
  if (!question) return { missing: ordered };

  const at = ctx.ports.clock.now().toISOString();
  const message: AppealMessage = {
    id: randomUUID(),
    appealId: ctx.appeal.id,
    direction: 'out',
    kind: 'question_card',
    body: question.question,
    fieldKey: question.key,
    card: questionCard(question, plan),
    createdAt: at,
  };
  await db.saveAppealMessage(message);
  if (ticket && ticket.status !== 'waiting_applicant') {
    await db.updateTicket(ticket.id, { status: 'waiting_applicant', updatedAt: at });
  }
  await ctx.bus?.publish({
    type: 'message.sent',
    actor: { kind: 'ai' },
    ...(ticket ? { ticketId: ticket.id } : {}),
    payload: {
      appealId: ctx.appeal.id,
      messageId: message.id,
      kind: message.kind,
      fieldKey: question.key,
      source: question.source,
    },
  });
  ctx.progress({
    stepId: CLARIFY_STEP_ID,
    status: 'progress',
    fields: [question.key],
    message: question.question,
  });

  return {
    // Заданный вопрос первым, дальше — остальные недостающие в порядке модели: их покажет чат.
    missing: [question, ...ordered.filter((field) => field.key !== question.key)],
    ext: {
      ...ctx.draft.ext,
      [CLARIFY_EXT_KEY]: {
        askedFieldKey: question.key,
        round: askedRounds(history, question.key) + 1,
        awaiting: true,
        source: question.source,
      },
    },
  };
}
