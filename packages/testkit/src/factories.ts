import type { AnalysisDraft, Appeal, FieldValue, User } from '@ugra/contracts';
import { createReferenceData } from '@ugra/core';
import type { Ports, ReferenceData } from '@ugra/core';

/** Текст примера заказчика: корпус Б, кабинет 312, принтер HP. */
export const SAMPLE_APPEAL_TEXT =
  'Корпус Б, кабинет 312, принтер HP не печатает, мигает красный индикатор';

function nowIso(): string {
  return new Date().toISOString();
}

/** Пользователь для тестов: по умолчанию заявитель. */
export function makeUser(partial: Partial<User> = {}): User {
  return {
    id: 'u-test',
    fullName: 'Тестовый Заявитель',
    role: 'applicant',
    departmentId: null,
    position: 'Заявитель',
    ...partial,
  };
}

/** Обращение для тестов: по умолчанию — текстовый чат с примером заказчика. */
export function makeAppeal(partial: Partial<Appeal> = {}): Appeal {
  return {
    id: 'appeal-test',
    channel: 'chat',
    authorId: 'u-test',
    originalText: SAMPLE_APPEAL_TEXT,
    attachments: [],
    createdAt: nowIso(),
    ...partial,
  };
}

/** Значение поля с готовой цитатой и следом: остаётся только подставить ключ и значение. */
export function makeField(
  key: string,
  value: FieldValue['value'],
  patch: Partial<FieldValue> = {},
): FieldValue {
  return {
    key,
    value,
    confidence: 0.9,
    quote: { sourceId: 'appeal', text: String(value) },
    origin: 'text',
    needsReview: false,
    trace: [{ kind: 'found', step: 'test', at: nowIso() }],
    ...patch,
  };
}

/** Пустой черновик разбора с источником из текста обращения. */
export function makeDraft(partial: Partial<AnalysisDraft> = {}): AnalysisDraft {
  return {
    ...partial,
    sources: partial.sources ?? [{ id: 'appeal', kind: 'text', text: SAMPLE_APPEAL_TEXT }],
    fields: partial.fields ?? {},
    missing: partial.missing ?? [],
    ext: partial.ext ?? {},
  };
}

/** Справочные данные для тестов: пустые, если не передано иное. */
export function makeReferenceData(partial: Partial<ReferenceData> = {}): ReferenceData {
  return createReferenceData(partial);
}

function notConfigured(name: string): never {
  throw new Error(`порт не настроен: ${name}`);
}

/**
 * Все порты — заглушки, которые падают при вызове: тест или контракт обязан явно
 * подставить нужный порт. Часы настоящие — время в тестах должно течь.
 */
export function makePorts(): Ports {
  return {
    llm: {
      structured: async (): Promise<never> => notConfigured('llm'),
      chat: async (): Promise<never> => notConfigured('llm'),
    },
    embeddings: {
      async embed(): Promise<never> {
        return notConfigured('embeddings');
      },
    },
    speech: {
      async transcribe(): Promise<never> {
        return notConfigured('speech');
      },
    },
    vision: {
      async describe(): Promise<never> {
        return notConfigured('vision');
      },
    },
    cmdb: {
      async findEquipment(): Promise<never> {
        return notConfigured('cmdb');
      },
      async locations(): Promise<never> {
        return notConfigured('cmdb');
      },
    },
    history: {
      async similar(): Promise<never> {
        return notConfigured('history');
      },
    },
    notifications: {
      async send(): Promise<never> {
        return notConfigured('notifications');
      },
    },
    clock: {
      now: () => new Date(),
    },
  };
}
