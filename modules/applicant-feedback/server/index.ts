import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppealMessage as AppealMessageSchema } from '@ugra/contracts';
import type {
  AppealMessage,
  DomainEvent,
  ReplyDraft,
  Ticket,
  UserNotification,
} from '@ugra/contracts';
import type { KernelStore, ModuleDeps, PipelineStep, StepContext } from '@ugra/core';
import { defineModule } from '@ugra/core';
import { buildConfirmation, buildReplyTemplate, hasUnknownNumbers, priorityLabel } from './template';

export const FEEDBACK_STEP_ID = 'applicant-feedback.draft';
/** Метка источника в событиях `message.sent`. */
export const FEEDBACK_SOURCE = 'applicant-feedback';

const REPLY_PROMPT_ID = 'modules/applicant-feedback/prompts/reply.v1.md';

/** Что вернёт модель: только текст. Схема одна, поэтому выдумать структуру нельзя. */
const ReplyText = z.object({ text: z.string().min(1).max(800) });

async function ticketOf(store: KernelStore, appealId: string): Promise<Ticket | null> {
  const tickets = await store.listTickets({ limit: 1000 });
  return tickets.find((ticket) => ticket.appealId === appealId) ?? null;
}

/**
 * Улучшение формулировки моделью. Работает только в облачном режиме: без ключа
 * и в заглушке шаг остаётся на шаблоне. Ошибка модели не ломает разбор —
 * это сообщение заявителю, а не анализ, поэтому шаблон остаётся допустимым.
 */
async function refineText(
  ctx: StepContext,
  templateText: string,
  number: string | null,
  label: string | null,
): Promise<{ text: string; template: boolean }> {
  const mode = (ctx.ports as { aiMode?: string }).aiMode;
  if (mode !== 'cloud') return { text: templateText, template: true };

  try {
    const response = await ctx.ports.llm.structured({
      promptId: REPLY_PROMPT_ID,
      vars: {
        number: number ?? '',
        priority: label ?? '',
        template: templateText,
        rules: [
          'Перепиши ответ заявителю коротко и вежливо.',
          'Не добавляй чисел, сроков, имён и обещаний, которых нет в template.',
          'Верни только текст сообщения.',
        ].join(' '),
      },
      schema: ReplyText,
      tier: 'cheap',
    });
    const text = response.value.text.trim();
    if (text === '' || hasUnknownNumbers(text, templateText)) {
      return { text: templateText, template: true };
    }
    return { text, template: false };
  } catch {
    // Модель недоступна — сообщение всё равно готово из данных заявки.
    return { text: templateText, template: true };
  }
}

/**
 * Шаг `applicant-feedback.draft`: черновик сообщения заявителю на стадии `respond`.
 * Собирается кодом из номера, приоритета и сроков — модели для этого не нужно.
 */
const draftStep: PipelineStep = {
  id: FEEDBACK_STEP_ID,
  title: 'Готовим ответ заявителю',
  stage: 'respond',
  order: 100,
  reads: ['fields', 'priority'],
  writes: ['replyDraft'],
  async run(ctx) {
    const ticket = ctx.db ? await ticketOf(ctx.db, ctx.appeal.id) : null;
    const number = ticket?.number ?? null;
    const priority = ctx.draft.priority ?? null;
    const label = priorityLabel(ctx.data, priority?.value);
    const now = ctx.ports.clock.now();

    const templateText = buildReplyTemplate({ number, priority, priorityLabel: label, now });
    const refined = await refineText(ctx, templateText, number, label);
    const replyDraft: ReplyDraft = { text: refined.text, template: refined.template };

    ctx.progress({
      stepId: FEEDBACK_STEP_ID,
      status: 'progress',
      message: refined.template ? 'Черновик ответа готов по шаблону' : 'Черновик ответа готов',
    });

    return { replyDraft };
  },
};

/** Сообщение заявителю после подтверждения: пишем в чат и уведомляем. Ошибки не валят назначение. */
async function sendConfirmation(event: DomainEvent, deps: ModuleDeps): Promise<void> {
  if (!event.ticketId) return;
  const ticket = await deps.db.getTicket(event.ticketId);
  if (!ticket) return;
  const appeal = await deps.db.getAppeal(ticket.appealId);
  if (!appeal) return;

  const assignee = ticket.assigneeId ? await deps.db.getUser(ticket.assigneeId) : null;
  const now = deps.clock.now();
  const body = buildConfirmation({
    number: ticket.number,
    assigneeName: assignee?.fullName ?? null,
    priorityLabel: priorityLabel(deps.data, ticket.priority),
    slaDueAt: ticket.slaDueAt,
    now,
  });
  const createdAt = now.toISOString();

  const message: AppealMessage = {
    id: randomUUID(),
    appealId: appeal.id,
    direction: 'out',
    kind: 'text',
    body,
    fieldKey: null,
    createdAt,
  };
  try {
    await deps.db.saveAppealMessage(message);
  } catch {
    // без записи в чат уведомление всё равно пробуем отправить
  }

  const title = `Заявка № ${ticket.number} принята`;
  const notification: UserNotification = {
    id: randomUUID(),
    toUserId: appeal.authorId,
    channel: 'inapp',
    title,
    body,
    ticketId: ticket.id,
    readAt: null,
    createdAt,
  };
  try {
    await deps.db.saveNotification(notification);
  } catch {
    // колокольчик — необязательный канал
  }
  try {
    await deps.ports.notifications.send({
      toUserId: appeal.authorId,
      channel: 'inapp',
      title,
      body,
      ticketId: ticket.id,
    });
  } catch {
    // заглушка канала не должна ломать подтверждение заявки
  }

  try {
    await deps.bus.publish({
      type: 'message.sent',
      actor: { kind: 'system' },
      ticketId: ticket.id,
      payload: {
        appealId: appeal.id,
        messageId: message.id,
        kind: message.kind,
        source: FEEDBACK_SOURCE,
      },
    });
  } catch {
    // журнал и подписчики не должны валить отправку
  }
}

/** Исходящее сообщение из карточки заявки: только диспетчер и админ (право `tickets.edit`). */
const SendReplyInput = z.object({ text: z.string().min(1).max(2000) });
const SendReplyResponse = z.object({
  message: AppealMessageSchema,
  ticketId: z.string(),
});

function routeError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

export default defineModule({
  id: 'applicant-feedback',
  title: 'Ответ заявителю',
  enabledByDefault: true,
  steps: [draftStep],
  events: [
    {
      type: 'applicant-feedback.message.sent',
      description: 'Диспетчер отправил заявителю готовый ответ из карточки заявки',
    },
  ],
  subscribers: [
    {
      on: 'ticket.confirmed',
      async handle(event, deps) {
        try {
          await sendConfirmation(event, deps);
        } catch {
          // подтверждение заявки важнее сообщения: ошибки не пробрасываем
        }
      },
    },
  ],
  routes(router) {
    router.post(
      '/tickets/:id/reply',
      'tickets.edit',
      async ({ params, body, user, deps }) => {
        const input = SendReplyInput.safeParse(body);
        if (!input.success) throw routeError('Пустой или слишком длинный текст ответа', 400);
        const text = input.data.text.trim();
        if (text === '') throw routeError('Пустой текст ответа', 400);

        const ticket = await deps.db.getTicket(params.id ?? '');
        if (!ticket) throw routeError('Заявка не найдена', 404);

        const createdAt = deps.clock.now().toISOString();
        const message: AppealMessage = {
          id: randomUUID(),
          appealId: ticket.appealId,
          direction: 'out',
          kind: 'text',
          body: text,
          fieldKey: null,
          createdAt,
        };
        await deps.db.saveAppealMessage(message);

        try {
          await deps.bus.publish({
            type: 'message.sent',
            actor: { kind: 'user', id: user.id },
            ticketId: ticket.id,
            payload: {
              appealId: ticket.appealId,
              messageId: message.id,
              kind: message.kind,
              source: FEEDBACK_SOURCE,
            },
          });
          await deps.bus.publish({
            type: 'applicant-feedback.message.sent',
            actor: { kind: 'user', id: user.id },
            ticketId: ticket.id,
            payload: { appealId: ticket.appealId, messageId: message.id },
          });
        } catch {
          // сообщение уже сохранено; журнал не должен ронять ответ
        }

        return { message, ticketId: ticket.id };
      },
      { body: SendReplyInput, response: SendReplyResponse },
    );
  },
});
