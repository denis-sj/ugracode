import { describe, expect, it } from 'vitest';
import type { AnalysisDraft, Appeal, FieldDef, FieldValue, Ticket } from '@ugra/contracts';
import type { KernelStore, StepContext } from '@ugra/core';
import { KernelEventBus, MemoryStore, createReferenceData } from '@ugra/core';
import { askedRounds, clarifyMissing } from '../server/clarify';

const now = new Date('2026-11-14T10:00:00.000Z');
const at = now.toISOString();

const fields: FieldDef[] = [
  {
    key: 'building',
    label: 'Корпус',
    group: 'location',
    type: 'dictionary',
    dictionary: 'building',
    required: true,
    extractHint: 'буква корпуса',
    ask: { question: 'В каком корпусе?', widget: 'select', optionsFrom: 'building' },
    evalMode: 'exact',
  },
  {
    key: 'cabinet',
    label: 'Кабинет',
    group: 'location',
    type: 'string',
    required: true,
    extractHint: 'номер кабинета',
    pattern: '^[0-9]{1,4}$',
    ask: { question: 'Номер кабинета?', widget: 'text' },
    evalMode: 'exact',
  },
  {
    key: 'symptoms',
    label: 'Что происходит',
    group: 'symptoms',
    type: 'text',
    required: false,
    extractHint: 'своими словами',
    evalMode: 'none',
  },
];

const appeal: Appeal = {
  id: 'appeal-1',
  channel: 'chat',
  authorId: 'u-applicant-1',
  originalText: 'Опять ничего не работает',
  attachments: [],
  createdAt: at,
};

function data(settings: Record<string, unknown> = {}): ReturnType<typeof createReferenceData> {
  return createReferenceData({
    fields,
    dictionaries: [
      { dictionary: 'building', code: 'А', label: 'Корпус А' },
      { dictionary: 'building', code: 'Б', label: 'Корпус Б' },
    ],
    settings,
  });
}

function draft(patch: Partial<AnalysisDraft> = {}): AnalysisDraft {
  return {
    sources: [{ id: appeal.id, kind: 'text', text: appeal.originalText }],
    fields: {},
    missing: [],
    ext: {},
    ...patch,
  };
}

function ticket(status: Ticket['status'] = 'ai_draft'): Ticket {
  return {
    id: 'ticket-1',
    number: 'З-20261114-0001',
    appealId: appeal.id,
    status,
    priority: null,
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
    createdAt: at,
    updatedAt: at,
  };
}

interface ContextOptions {
  draft?: AnalysisDraft;
  db?: KernelStore | null;
  settings?: Record<string, unknown>;
  ticketStatus?: Ticket['status'];
  withTicket?: boolean;
}

async function context(options: ContextOptions = {}): Promise<{ ctx: StepContext; store: KernelStore }> {
  const store: KernelStore = options.db === undefined || options.db === null ? new MemoryStore() : options.db;
  await store.saveAppeal(appeal);
  if (options.withTicket !== false) await store.saveTicket(ticket(options.ticketStatus));
  return {
    store,
    ctx: {
      runId: 'run-1',
      appeal,
      db: options.db === null ? undefined : store,
      bus: new KernelEventBus(store),
      draft: options.draft ?? draft(),
      ports: {
        llm: {
          structured: async () => Promise.reject(new Error('llm не нужен')),
          chat: async () => Promise.reject(new Error('llm не нужен')),
        },
        embeddings: { embed: async () => Promise.reject(new Error('embeddings не нужны')) },
        speech: { transcribe: async () => Promise.reject(new Error('speech не нужен')) },
        vision: { describe: async () => Promise.reject(new Error('vision не нужен')) },
        cmdb: { findEquipment: async () => [], locations: async () => [] },
        history: { similar: async () => [] },
        notifications: { send: async () => ({ delivered: true }) },
        tts: { available: false, speak: () => Promise.reject(new Error('tts не нужен')) },
        clock: { now: () => now },
      },
      data: data(options.settings),
      progress: () => undefined,
      trace: () => undefined,
      signal: new AbortController().signal,
    },
  };
}

function fieldValue(value: string | null, trace: FieldValue['trace'] = []): FieldValue {
  return {
    key: 'building',
    value,
    confidence: 0.9,
    quote: null,
    origin: 'asked',
    needsReview: false,
    trace,
  };
}

describe('шаг clarify.missing', () => {
  it('без недостающих полей ничего не спрашивает', async () => {
    const { ctx, store } = await context({
      draft: draft({ fields: { building: fieldValue('Б'), cabinet: fieldValue('312') } }),
    });

    await expect(clarifyMissing(ctx)).resolves.toEqual({ missing: [] });
    expect(await store.listAppealMessages(appeal.id)).toEqual([]);
  });

  it('задаёт один вопрос по первому недостающему полю и сохраняет карточку', async () => {
    const { ctx, store } = await context({ draft: draft({ fields: { cabinet: fieldValue('312') } }) });

    const patch = await clarifyMissing(ctx);

    expect(patch?.missing).toHaveLength(1);
    const question = patch?.missing?.[0];
    expect(question).toMatchObject({
      key: 'building',
      question: 'В каком корпусе?',
      source: 'template',
      allowUnknown: true,
      allowFreeText: true,
      options: [
        { value: 'А', label: 'Корпус А', validated: true },
        { value: 'Б', label: 'Корпус Б', validated: true },
      ],
    });
    const messages = await store.listAppealMessages(appeal.id);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      appealId: appeal.id,
      direction: 'out',
      kind: 'question_card',
      body: 'В каком корпусе?',
      fieldKey: 'building',
    });
    expect(messages[0]?.card).toMatchObject({ cardType: 'question' });

    const ticketAfter = await store.getTicket('ticket-1');
    expect(ticketAfter?.status).toBe('waiting_applicant');
    const events = await store.listEvents({ ticketId: 'ticket-1', type: 'message.sent' });
    expect(events).toHaveLength(1);
    expect((patch?.ext?.['clarify-chat'] as { askedFieldKey?: string } | undefined)?.askedFieldKey).toBe('building');
  });

  it('не задаёт вопрос повторно, пока ответа нет', async () => {
    const { ctx, store } = await context({ draft: draft() });
    await store.saveAppealMessage({
      id: 'm-1',
      appealId: appeal.id,
      direction: 'out',
      kind: 'question_card',
      body: 'В каком корпусе?',
      fieldKey: 'building',
      createdAt: at,
    });

    const patch = await clarifyMissing(ctx);

    // Первое поле уже спрошено и ждёт ответа — спрашиваем следующее.
    expect(patch?.missing?.[0]?.key).toBe('cabinet');
    expect(await store.listAppealMessages(appeal.id)).toHaveLength(2);
  });

  it('берёт вопрос модели и отбрасывает варианты вне справочника', async () => {
    const { ctx } = await context({
      draft: draft({
        fields: { cabinet: fieldValue('312') },
        ext: {
          extraction: {
            clarify: { fieldKey: 'building', question: 'Из какого вы корпуса?', options: ['Б', 'Выдуманный'] },
          },
        },
      }),
    });

    const patch = await clarifyMissing(ctx);

    expect(patch?.missing?.[0]).toMatchObject({
      key: 'building',
      question: 'Из какого вы корпуса?',
      source: 'ai',
      options: [{ value: 'Б', label: 'Корпус Б', validated: true }],
    });
  });

  it('соблюдает лимит кругов: одно поле спрашиваем не больше maxClarifyRounds раз', async () => {
    const { ctx, store } = await context({
      draft: draft({ fields: { cabinet: fieldValue('312') } }),
      settings: { maxClarifyRounds: 2 },
    });
    for (const id of ['m-1', 'm-2']) {
      await store.saveAppealMessage({
        id,
        appealId: appeal.id,
        direction: 'out',
        kind: 'question_card',
        body: 'В каком корпусе?',
        fieldKey: 'building',
        createdAt: at,
      });
    }

    const patch = await clarifyMissing(ctx);

    expect(askedRounds(await store.listAppealMessages(appeal.id), 'building')).toBe(2);
    expect(await store.listAppealMessages(appeal.id)).toHaveLength(2);
    expect(patch?.missing?.map((field) => field.key)).toEqual(['building']);
  });

  it('после «Не знаю» поле больше не спрашивает', async () => {
    const { ctx, store } = await context({
      draft: draft({
        fields: {
          building: {
            ...fieldValue(null),
            needsReview: true,
            trace: [{ kind: 'no_answer', step: 'clarify-chat.answer', at }],
          },
          cabinet: fieldValue('312'),
        },
      }),
    });

    const patch = await clarifyMissing(ctx);

    expect(patch?.missing?.map((field) => field.key)).toEqual(['building']);
    expect(await store.listAppealMessages(appeal.id)).toEqual([]);
  });

  it('учитывает уже сохранённые поля заявки при повторном разборе', async () => {
    const { ctx, store } = await context({
      draft: draft({ fields: { cabinet: fieldValue('312') } }),
    });
    await store.saveTicketFields('ticket-1', [
      {
        ticketId: 'ticket-1',
        fieldKey: 'building',
        value: 'Б',
        confidence: 1,
        quote: null,
        origin: 'asked',
        needsReview: false,
        trace: [],
        aiValue: 'Б',
      },
    ]);

    const patch = await clarifyMissing(ctx);

    expect(patch?.missing).toEqual([]);
    expect(await store.listAppealMessages(appeal.id)).toEqual([]);
  });

  it('без хранилища отдаёт список недостающих и не падает', async () => {
    const { ctx } = await context({ db: null, draft: draft() });

    const patch = await clarifyMissing(ctx);

    expect(patch?.missing?.map((field) => field.key)).toEqual(['building', 'cabinet']);
  });
});

describe('шаг clarify.missing: вопросы модели', () => {
  const cabinetQuestion = { fieldKey: 'cabinet', question: 'В каком кабинете стоит принтер?', options: [] };
  const buildingQuestion = { fieldKey: 'building', question: 'Принтер в главном корпусе или в Б?', options: ['Б'] };

  it('спрашивает сначала то, что модель считает важнее, а не первое по реестру', async () => {
    const { ctx, store } = await context({
      draft: draft({ ext: { extraction: { questions: [cabinetQuestion, buildingQuestion] } } }),
    });

    const patch = await clarifyMissing(ctx);

    expect(patch?.missing?.map((item) => item.key)).toEqual(['cabinet', 'building']);
    expect(patch?.missing?.[0]).toMatchObject({ question: cabinetQuestion.question, source: 'ai' });
    expect(patch?.missing?.[1]).toMatchObject({ question: buildingQuestion.question, source: 'ai' });
    const [message] = await store.listAppealMessages(appeal.id);
    expect(message?.fieldKey).toBe('cabinet');
    expect(message?.card?.payload.plan).toEqual([cabinetQuestion, buildingQuestion]);
  });

  it('после ответа задаёт следующий вопрос модели из плана, а не шаблон', async () => {
    const { ctx: first, store } = await context({
      draft: draft({ ext: { extraction: { questions: [cabinetQuestion, buildingQuestion] } } }),
    });
    await clarifyMissing(first);
    await store.saveAppealMessage({
      id: 'answer-1',
      appealId: appeal.id,
      direction: 'in',
      kind: 'answer',
      body: '312',
      fieldKey: 'cabinet',
      createdAt: at,
    });

    // Повторный разбор идёт с validate: черновик без вопросов модели, кабинет уже отвечен.
    const { ctx: rerun } = await context({ db: store, draft: draft({ fields: { cabinet: fieldValue('312') } }) });
    const patch = await clarifyMissing(rerun);

    expect(patch?.missing?.[0]).toMatchObject({ key: 'building', question: buildingQuestion.question, source: 'ai' });
  });
});
