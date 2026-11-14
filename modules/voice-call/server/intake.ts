import { randomUUID } from 'node:crypto';
import type { Appeal, AppealMessage, User } from '@ugra/contracts';
import type { ModuleDeps } from '@ugra/core';
import type { CallAppeal, CallIntake } from './service';

/** Заявитель по умолчанию для звонков: номер телефона в профиле пользователя пока не хранится. */
export const PHONE_CALLER: User = {
  id: 'u-phone-caller',
  fullName: 'Звонок на номер поддержки',
  role: 'applicant',
  departmentId: null,
  position: 'Заявитель по телефону',
};

/** Запуск разбора обращения: тот же пайплайн, что у чата. Даёт сервер приложения. */
export type AnalyzeAppeal = (appeal: Appeal, ticketId: string) => Promise<void>;

export async function ensurePhoneCaller(db: ModuleDeps['db']): Promise<User> {
  const existing = await db.getUser(PHONE_CALLER.id);
  if (existing) return existing;
  await db.saveUser(PHONE_CALLER);
  return PHONE_CALLER;
}

function message(appealId: string, direction: AppealMessage['direction'], kind: AppealMessage['kind'], body: string, createdAt: string): AppealMessage {
  return { id: randomUUID(), appealId, direction, kind, body, fieldKey: null, createdAt };
}

/**
 * Итог звонка → обращение `channel: 'phone'` и черновик заявки.
 *
 * Разговор пишется в чат обращения (номер звонящего — системной строкой), поэтому диспетчер
 * видит в карточке, что спросил ИИ и что ответил человек. Разбор запускается без ожидания:
 * звонящий слышит номер заявки сразу, а поля появляются у диспетчера через 15–30 с.
 */
export function createCallIntake(deps: ModuleDeps, analyze: AnalyzeAppeal | null): CallIntake {
  return {
    async submit(call: CallAppeal) {
      const author = await ensurePhoneCaller(deps.db);
      const createdAt = deps.clock.now().toISOString();
      const appeal: Appeal = {
        id: randomUUID(),
        channel: 'phone',
        authorId: author.id,
        originalText: call.text,
        attachments: [],
        createdAt,
      };
      await deps.db.saveAppeal(appeal);
      const contact = call.from && call.from.toLowerCase() !== 'anonymous' ? call.from : 'скрыт';
      await deps.db.saveAppealMessage(
        message(appeal.id, 'in', 'system', `Звонок на номер поддержки. Номер звонящего: ${contact}. Разговор вёл ИИ-оператор.`, createdAt),
      );
      for (const line of call.lines) {
        if (line.text.trim() === '') continue;
        await deps.db.saveAppealMessage(
          message(appeal.id, line.speaker === 'caller' ? 'in' : 'out', 'text', line.text, line.at),
        );
      }
      await deps.bus.publish({
        type: 'appeal.created',
        actor: { kind: 'ai' },
        payload: { appealId: appeal.id, channel: appeal.channel, callId: call.callId, emergency: call.emergency },
      });
      const ticket = await deps.tickets.createDraft(appeal);
      await deps.tickets.transition(ticket.id, 'ai_draft', { kind: 'system' });
      if (analyze) {
        // Не ждём: звонящему нужен номер заявки сейчас. Ошибка разбора видна в журнале пайплайна.
        void analyze(appeal, ticket.id).catch(() => undefined);
      }
      return { appealId: appeal.id, ticketId: ticket.id, ticketNumber: ticket.number };
    },
  };
}
