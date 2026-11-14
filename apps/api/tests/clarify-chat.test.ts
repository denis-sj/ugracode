import { describe, expect, it } from 'vitest';
import type { AppealMessage, TicketResponse } from '@ugra/contracts';
import { MemoryStore } from '@ugra/core';
import { serverModules } from '../../../modules/registry.server';
import { buildServer, type AppContext } from '../src/server';
import { seedUsers, testPorts, testReferenceData } from './helpers';

interface Setup {
  ctx: AppContext;
  appealId: string;
  ticketId: string;
  applicant: string;
  dispatcher: string;
  engineer: string;
}

async function setup(env: Record<string, string | undefined> = { AI_MODE: 'stub' }): Promise<Setup> {
  const store = new MemoryStore();
  const users = await seedUsers(store);
  const baseData = testReferenceData();
  const ctx = await buildServer({
    store,
    ports: testPorts(),
    // Для этого набора обязательна только категория: вопрос всегда про неё.
    data: {
      ...baseData,
      fields: baseData.fields.map((field) => ({ ...field, required: field.key === 'category' })),
    },
    modules: serverModules,
    env,
  });
  const login = async (userId: string): Promise<string> => {
    const response = await ctx.app.inject({ method: 'POST', url: '/api/session', payload: { userId } });
    const raw = response.headers['set-cookie'];
    return String(Array.isArray(raw) ? raw[0] : raw).split(';')[0] ?? '';
  };
  const applicant = await login(users.applicant.id);
  const dispatcher = await login(users.dispatcher.id);
  const engineer = await login(users.engineer.id);
  const created = await ctx.app.inject({
    method: 'POST',
    url: '/api/appeals',
    headers: { cookie: applicant },
    payload: { text: 'Корпус Б, кабинет 312, не печатает, мигает индикатор' },
  });
  const body = created.json() as { appealId: string; ticketId: string };
  return { ctx, appealId: body.appealId, ticketId: body.ticketId, applicant, dispatcher, engineer };
}

async function messagesOf(ctx: AppContext, appealId: string, cookie: string): Promise<AppealMessage[]> {
  const response = await ctx.app.inject({
    method: 'GET',
    url: `/api/appeals/${appealId}/messages`,
    headers: { cookie },
  });
  expect(response.statusCode).toBe(200);
  return (response.json() as { messages: AppealMessage[] }).messages;
}

async function ticketOf(ctx: AppContext, ticketId: string, cookie: string): Promise<TicketResponse> {
  const response = await ctx.app.inject({
    method: 'GET',
    url: `/api/tickets/${ticketId}`,
    headers: { cookie },
  });
  expect(response.statusCode).toBe(200);
  return response.json() as TicketResponse;
}

function traceKinds(trace: readonly unknown[]): string[] {
  return trace.map((entry) => (typeof entry === 'object' && entry !== null ? String((entry as { kind: unknown }).kind) : ''));
}

async function answer(
  ctx: AppContext,
  appealId: string,
  cookie: string,
  body: string,
  fieldKey = 'category',
): Promise<{ message: AppealMessage; ticketId: string; runId: string | null }> {
  const response = await ctx.app.inject({
    method: 'POST',
    url: `/api/appeals/${appealId}/messages`,
    headers: { cookie },
    payload: { kind: 'answer', body, fieldKey },
  });
  expect(response.statusCode).toBe(200);
  return response.json() as { message: AppealMessage; ticketId: string; runId: string | null };
}

describe('чат обращения: вопросы и ответы', () => {
  it('разбор создаёт карточку-вопрос и сохраняет её в историю', async () => {
    const { ctx, appealId, applicant } = await setup();

    const messages = await messagesOf(ctx, appealId, applicant);
    const question = messages.find((message) => message.kind === 'question_card');

    expect(question).toBeDefined();
    expect(question?.direction).toBe('out');
    expect(question?.fieldKey).toBe('category');
    expect(question?.body.length).toBeGreaterThan(0);
    expect(question?.card).toMatchObject({ cardType: 'question' });
    const payload = question?.card?.payload as { options?: { value: string; validated: boolean }[] };
    expect(payload.options?.map((option) => option.value)).toContain('printer');
    expect(payload.options?.every((option) => option.validated)).toBe(true);
  });

  it('ответ заполняет поле, оставляет след и перезапускает разбор', async () => {
    const { ctx, appealId, ticketId, applicant } = await setup();

    const answerResult = await answer(ctx, appealId, applicant, 'printer');

    expect(answerResult.ticketId).toBe(ticketId);
    expect(answerResult.runId).toBeTruthy();
    expect(answerResult.message).toMatchObject({
      direction: 'in',
      kind: 'answer',
      body: 'printer',
      fieldKey: 'category',
    });

    const detail = await ticketOf(ctx, ticketId, applicant);
    const field = detail.fields.find((item) => item.fieldKey === 'category');
    expect(field).toMatchObject({ value: 'printer', origin: 'asked', needsReview: false, confidence: 1 });
    expect(traceKinds(field?.trace ?? [])).toEqual(['asked', 'answered']);
    // Прежние поля разбора не потерялись после повторного запуска с `validate`.
    expect(detail.fields.find((item) => item.fieldKey === 'cabinet')?.value).toBe('312');

    const events = await ctx.store.listEvents({ ticketId });
    const types = events.map((event) => event.type);
    expect(types).toContain('message.sent');
    expect(types).toContain('ticket.field.set');
    const sent = events.find((event) => event.type === 'ticket.field.set' && (event.payload as { fieldKey?: string }).fieldKey === 'category');
    expect((sent?.payload as { origin?: string }).origin).toBe('asked');
  });

  it('«Не знаю» отправляет поле диспетчеру и больше его не спрашивает', async () => {
    const { ctx, appealId, ticketId, applicant } = await setup();

    await answer(ctx, appealId, applicant, 'Не знаю');

    const detail = await ticketOf(ctx, ticketId, applicant);
    const field = detail.fields.find((item) => item.fieldKey === 'category');
    expect(field).toMatchObject({ value: null, origin: 'asked', needsReview: true });
    expect(traceKinds(field?.trace ?? [])).toEqual(['asked', 'no_answer']);
    expect(detail.ticket.status).toBe('in_review');

    const messages = await messagesOf(ctx, appealId, applicant);
    expect(messages.filter((message) => message.kind === 'question_card' && message.fieldKey === 'category')).toHaveLength(1);
  });

  it('принимает «unknown» как «Не знаю»', async () => {
    const { ctx, appealId, ticketId, applicant } = await setup();

    await answer(ctx, appealId, applicant, 'unknown');

    const detail = await ticketOf(ctx, ticketId, applicant);
    expect(detail.fields.find((item) => item.fieldKey === 'category')).toMatchObject({
      value: null,
      needsReview: true,
    });
  });

  it('чужой не может ответить и прочитать чат', async () => {
    const { ctx, appealId, engineer } = await setup();

    const written = await ctx.app.inject({
      method: 'POST',
      url: `/api/appeals/${appealId}/messages`,
      headers: { cookie: engineer },
      payload: { kind: 'answer', body: 'printer', fieldKey: 'category' },
    });
    expect(written.statusCode).toBe(403);

    const read = await ctx.app.inject({
      method: 'GET',
      url: `/api/appeals/${appealId}/messages`,
      headers: { cookie: engineer },
    });
    expect(read.statusCode).toBe(403);
  });

  it('диспетчер видит чат и может ответить заявителю', async () => {
    const { ctx, appealId, dispatcher } = await setup();

    const messages = await messagesOf(ctx, appealId, dispatcher);
    expect(messages.length).toBeGreaterThan(0);
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/appeals/${appealId}/messages`,
      headers: { cookie: dispatcher },
      payload: { kind: 'text', body: 'Уточните, пожалуйста, кабинет' },
    });
    expect(response.statusCode).toBe(200);
    expect((response.json() as { runId: string | null }).runId).toBeNull();
  });

  it('отклоняет ответ по полю вне реестра', async () => {
    const { ctx, appealId, applicant } = await setup();

    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/appeals/${appealId}/messages`,
      headers: { cookie: applicant },
      payload: { kind: 'answer', body: 'x', fieldKey: 'unknown-field' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('повторный разбор не дублирует вопрос, который ждёт ответа', async () => {
    const { ctx, appealId, ticketId, applicant, dispatcher } = await setup();
    const count = async (): Promise<number> =>
      (await messagesOf(ctx, appealId, applicant)).filter(
        (message) => message.kind === 'question_card' && message.fieldKey === 'category',
      ).length;
    expect(await count()).toBe(1);

    for (const expected of [1, 1]) {
      const rerun = await ctx.app.inject({
        method: 'POST',
        url: `/api/tickets/${ticketId}/reanalyze`,
        headers: { cookie: dispatcher },
      });
      expect(rerun.statusCode).toBe(200);
      // Вопрос уже задан и ответа нет — второй раз не спрашиваем.
      expect(await count()).toBe(expected);
    }
  });

  it('с выключенным модулем вопросов нет, заявка собирается', async () => {
    const { ctx, appealId, applicant, ticketId } = await setup({ FEATURES_OFF: 'clarify-chat' });

    const messages = await messagesOf(ctx, appealId, applicant);
    expect(messages).toEqual([]);
    const detail = await ticketOf(ctx, ticketId, applicant);
    expect(detail.ticket.status).toBe('in_review');
  });
});
