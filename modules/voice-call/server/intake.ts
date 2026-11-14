import { randomUUID } from 'node:crypto';
import type { Appeal, AppealMessage, User } from '@ugra/contracts';
import type { ModuleDeps } from '@ugra/core';
import type { CallAppeal, CallIntake } from './service';

/** Заявитель для звонков по QR: звонящий не входит в систему, контакт уточняет диспетчер. */
export const CALL_APPLICANT: User = {
  id: 'u-call-guest',
  fullName: 'Звонок ИИ-оператору',
  role: 'applicant',
  departmentId: null,
  position: 'Заявитель по звонку',
};

export async function ensureCallApplicant(db: ModuleDeps['db']): Promise<User> {
  const existing = await db.getUser(CALL_APPLICANT.id);
  if (existing) return existing;
  await db.saveUser(CALL_APPLICANT);
  return CALL_APPLICANT;
}

function message(
  appealId: string,
  direction: AppealMessage['direction'],
  kind: AppealMessage['kind'],
  body: string,
  createdAt: string,
): AppealMessage {
  return { id: randomUUID(), appealId, direction, kind, body, fieldKey: null, createdAt };
}

/**
 * Итог звонка → обращение `channel: 'phone'` через `ModuleDeps.appeals` — тот же путь, что у чата.
 *
 * Разбор идёт в фоне (`wait: false`): звонящий сразу слышит номер заявки, а поля появляются у
 * диспетчера через 15–30 с. Разговор пишется в чат обращения: в карточке видно, что спросил ИИ
 * и что ответил человек.
 */
export function createCallIntake(deps: ModuleDeps): CallIntake {
  return {
    async submit(call: CallAppeal) {
      if (!deps.appeals) throw new Error('Сервер не дал приём обращений (ModuleDeps.appeals)');
      const author = await ensureCallApplicant(deps.db);
      const createdAt = deps.clock.now().toISOString();
      const appeal: Appeal = {
        id: randomUUID(),
        channel: 'phone',
        authorId: author.id,
        originalText: call.text,
        attachments: [],
        createdAt,
      };
      const result = await deps.appeals.submit(appeal, { actor: { kind: 'ai' }, wait: false });
      const device = call.from.trim() === '' ? '' : ` Устройство: ${call.from}.`;
      await deps.db.saveAppealMessage(
        message(appeal.id, 'in', 'system', `Звонок ИИ-оператору по QR-коду.${device} Разговор вёл ИИ-оператор.`, createdAt),
      );
      for (const line of call.lines) {
        if (line.text.trim() === '') continue;
        await deps.db.saveAppealMessage(
          message(appeal.id, line.speaker === 'caller' ? 'in' : 'out', 'text', line.text, line.at),
        );
      }
      return { appealId: result.appealId, ticketId: result.ticketId, ticketNumber: result.ticketNumber };
    },
  };
}
