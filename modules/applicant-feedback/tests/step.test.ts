import { describe, expect, it } from 'vitest';
import type { AnalysisDraft, PriorityVerdict, Ticket } from '@ugra/contracts';
import type { LlmPort, Ports, StepContext } from '@ugra/core';
import { createReferenceData, MemoryStore } from '@ugra/core';
import { makeAppeal, makeDraft, makePorts } from '@ugra/testkit';
import applicantFeedback, { FEEDBACK_STEP_ID } from '../server';
import { buildReplyTemplate, hasUnknownNumbers } from '../server/template';

const NOW = new Date(2026, 10, 14, 10, 0, 0);
const appeal = makeAppeal({ id: 'appeal-1' });

const data = createReferenceData({
  dictionaries: [
    { dictionary: 'priority', code: 'high', label: 'Высокий' },
    { dictionary: 'priority', code: 'low', label: 'Низкий' },
  ],
});

function priority(level: PriorityVerdict['value']): PriorityVerdict {
  return {
    value: level,
    reactDueAt: new Date(NOW.getTime() + 15 * 60_000).toISOString(),
    slaDueAt: new Date(NOW.getTime() + 8 * 60 * 60_000).toISOString(),
    rule: 'матрица',
    reasons: [],
  };
}

function ticket(patch: Partial<Ticket> = {}): Ticket {
  const base: Ticket = {
    id: 'ticket-1',
    number: 'З-20261114-0001',
    appealId: appeal.id,
    status: 'in_review',
    priority: 'high',
    category: null,
    departmentId: null,
    assigneeId: null,
    isEmergency: false,
    incidentId: null,
    reactDueAt: null,
    slaDueAt: null,
    equipmentId: null,
    locationId: null,
    confirmedBy: null,
    confirmedAt: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };
  return { ...base, ...patch } as Ticket;
}

function fixedPorts(): Ports {
  return { ...makePorts(), clock: { now: () => NOW } };
}

function context(
  draft: AnalysisDraft,
  options: { ports?: Ports; store?: MemoryStore } = {},
): StepContext {
  return {
    runId: 'run-1',
    appeal,
    draft,
    ports: options.ports ?? fixedPorts(),
    data,
    progress: () => undefined,
    trace: () => undefined,
    signal: new AbortController().signal,
    db: options.store,
  };
}

function cloudPorts(llm: LlmPort): Ports & { aiMode: 'cloud' } {
  return { ...fixedPorts(), llm, aiMode: 'cloud' };
}

function llmReturning(text: string): LlmPort {
  return {
    structured: async (req) => ({
      value: req.schema.parse({ text }),
      model: 'stub',
      promptVersion: 'test',
      cached: false,
    }),
    chat: async () => Promise.reject(new Error('чат не нужен')),
  };
}

const step = applicantFeedback.steps.find((item) => item.id === FEEDBACK_STEP_ID);

describe('applicant-feedback: шаг applicant-feedback.draft', () => {
  it('собирает шаблон из номера, приоритета и срока заявки', async () => {
    const store = new MemoryStore();
    await store.saveTicket(ticket());

    const patch = await step?.run(context(makeDraft({ priority: priority('high') }), { store }));

    expect(patch?.replyDraft?.template).toBe(true);
    expect(patch?.replyDraft?.text).toContain('Заявка № З-20261114-0001 принята');
    expect(patch?.replyDraft?.text).toContain('приоритет «Высокий»');
    expect(patch?.replyDraft?.text).toContain('срок решения — сегодня до 18:00');
  });

  it('без заявки и приоритета остаётся короткое «заявка принята» без цифр', async () => {
    const patch = await step?.run(context(makeDraft()));

    expect(patch?.replyDraft?.text).toBe(
      'Заявка принята. Диспетчер проверит заявку и назначит исполнителя.',
    );
    expect(patch?.replyDraft?.text).not.toMatch(/\d/);
  });

  it('приоритет без номера заявки: приоритет и срок есть, номера нет', async () => {
    const patch = await step?.run(context(makeDraft({ priority: priority('low') })));

    expect(patch?.replyDraft?.text).toContain('Заявка принята, приоритет «Низкий»');
    expect(patch?.replyDraft?.text).not.toContain('№');
  });

  it('облачная модель улучшает формулировку, если не добавила новых чисел', async () => {
    const template = buildReplyTemplate({
      number: 'З-20261114-0001',
      priority: priority('high'),
      priorityLabel: 'Высокий',
      now: NOW,
    });
    const improved = template.replace('Заявка', 'Ваша заявка');
    const store = new MemoryStore();
    await store.saveTicket(ticket());

    const patch = await step?.run(
      context(makeDraft({ priority: priority('high') }), {
        store,
        ports: cloudPorts(llmReturning(improved)),
      }),
    );

    expect(patch?.replyDraft?.template).toBe(false);
    expect(patch?.replyDraft?.text).toBe(improved);
  });

  it('модель выдумала число — остаётся шаблон', async () => {
    const invented = 'Заявка № 12 принята, инженер придёт через 5 минут.';
    const store = new MemoryStore();
    await store.saveTicket(ticket());

    const patch = await step?.run(
      context(makeDraft({ priority: priority('high') }), {
        store,
        ports: cloudPorts(llmReturning(invented)),
      }),
    );

    expect(patch?.replyDraft?.template).toBe(true);
    expect(patch?.replyDraft?.text).not.toContain('5 минут');
    expect(hasUnknownNumbers(invented, patch?.replyDraft?.text ?? '')).toBe(true);
  });

  it('модель недоступна — сообщение всё равно готово по шаблону', async () => {
    const store = new MemoryStore();
    await store.saveTicket(ticket());
    const ports = cloudPorts({
      structured: async () => Promise.reject(new Error('нет сети')),
      chat: async () => Promise.reject(new Error('нет сети')),
    });

    const patch = await step?.run(
      context(makeDraft({ priority: priority('high') }), { store, ports }),
    );

    expect(patch?.replyDraft?.template).toBe(true);
    expect(patch?.replyDraft?.text).toContain('Заявка № З-20261114-0001 принята');
  });

  it('в режиме заглушки модель не вызывается', async () => {
    let called = false;
    const ports: Ports = {
      ...makePorts(),
      llm: {
        structured: async (req) => {
          called = true;
          return {
            value: req.schema.parse({ text: '' }),
            model: 'stub',
            promptVersion: 'test',
            cached: false,
          };
        },
        chat: async () => Promise.reject(new Error('чат не нужен')),
      },
    };

    const patch = await step?.run(context(makeDraft(), { ports }));

    expect(called).toBe(false);
    expect(patch?.replyDraft?.template).toBe(true);
  });
});
