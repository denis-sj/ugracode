import { describe, expect, it } from 'vitest';
import { MemoryStore } from '@ugra/core';
import { buildServer, type AppContext } from '../src/server';
import { PRINTER_TEXT, seedUsers, testPorts, testReferenceData } from './helpers';

interface Fixture {
  ctx: AppContext;
  ticketId: string;
  applicant: string;
  dispatcher: string;
  engineer: string;
  manager: string;
}

async function login(ctx: AppContext, userId: string): Promise<string> {
  const response = await ctx.app.inject({ method: 'POST', url: '/api/session', payload: { userId } });
  expect(response.statusCode).toBe(200);
  const raw = response.headers['set-cookie'];
  return String(Array.isArray(raw) ? raw[0] : raw).split(';')[0] ?? '';
}

async function fixture(): Promise<Fixture> {
  const store = new MemoryStore();
  const users = await seedUsers(store);
  const ctx = await buildServer({
    store,
    ports: testPorts(),
    data: testReferenceData(),
    env: { AI_MODE: 'stub' },
  });
  const applicant = await login(ctx, users.applicant.id);
  const dispatcher = await login(ctx, users.dispatcher.id);
  const engineer = await login(ctx, users.engineer.id);
  const manager = await login(ctx, users.manager.id);
  const created = await ctx.app.inject({
    method: 'POST',
    url: '/api/appeals',
    headers: { cookie: applicant },
    payload: { text: PRINTER_TEXT },
  });
  expect(created.statusCode).toBe(200);
  return {
    ctx,
    ticketId: (created.json() as { ticketId: string }).ticketId,
    applicant,
    dispatcher,
    engineer,
    manager,
  };
}

describe('проверка диспетчером', () => {
  it('подтверждает заявку и назначает инженера', async () => {
    const { ctx, ticketId, dispatcher } = await fixture();
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/tickets/${ticketId}/confirm`,
      headers: { cookie: dispatcher },
      payload: { assigneeId: 'u-engineer-1' },
    });
    expect(response.statusCode).toBe(200);
    const ticket = response.json() as { status: string; assigneeId: string; number: string };
    expect(ticket.status).toBe('assigned');
    expect(ticket.assigneeId).toBe('u-engineer-1');
  });

  it('отклоняет назначение не-инженера', async () => {
    const { ctx, ticketId, dispatcher } = await fixture();
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/tickets/${ticketId}/confirm`,
      headers: { cookie: dispatcher },
      payload: { assigneeId: 'u-applicant-1' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('заявитель не может подтвердить заявку', async () => {
    const { ctx, ticketId, applicant } = await fixture();
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/tickets/${ticketId}/confirm`,
      headers: { cookie: applicant },
      payload: { assigneeId: 'u-engineer-1' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('правит поле и сохраняет вариант ИИ', async () => {
    const { ctx, ticketId, dispatcher } = await fixture();
    const response = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/tickets/${ticketId}/fields/cabinet`,
      headers: { cookie: dispatcher },
      payload: { value: '313' },
    });
    expect(response.statusCode).toBe(200);
    const field = response.json() as { value: string; aiValue: string; origin: string };
    expect(field.value).toBe('313');
    expect(field.aiValue).toBe('312');
    expect(field.origin).toBe('human');
  });

  it('не правит несуществующее поле', async () => {
    const { ctx, ticketId, dispatcher } = await fixture();
    const response = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/tickets/${ticketId}/fields/nope`,
      headers: { cookie: dispatcher },
      payload: { value: 'x' },
    });
    expect(response.statusCode).toBe(404);
  });

  it('инженер берёт заявку в работу, заявитель — нет', async () => {
    const { ctx, ticketId, dispatcher, engineer, applicant } = await fixture();
    await ctx.app.inject({
      method: 'POST',
      url: `/api/tickets/${ticketId}/confirm`,
      headers: { cookie: dispatcher },
      payload: { assigneeId: 'u-engineer-1' },
    });
    const taken = await ctx.app.inject({
      method: 'POST',
      url: `/api/tickets/${ticketId}/transition`,
      headers: { cookie: engineer },
      payload: { to: 'in_progress' },
    });
    expect(taken.statusCode).toBe(200);
    expect((taken.json() as { status: string }).status).toBe('in_progress');
    const forbidden = await ctx.app.inject({
      method: 'POST',
      url: `/api/tickets/${ticketId}/transition`,
      headers: { cookie: applicant },
      payload: { to: 'closed' },
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it('отдаёт журнал действий по заявке', async () => {
    const { ctx, ticketId, dispatcher } = await fixture();
    await ctx.app.inject({
      method: 'PATCH',
      url: `/api/tickets/${ticketId}/fields/cabinet`,
      headers: { cookie: dispatcher },
      payload: { value: '313' },
    });
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/tickets/${ticketId}/events`,
      headers: { cookie: dispatcher },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { events: { type: string }[] };
    expect(body.events.map((event) => event.type)).toContain('ticket.field.corrected');
    expect(body.events.map((event) => event.type)).toContain('ticket.status.changed');
  });

  it('инженер не видит журнал действий', async () => {
    const { ctx, ticketId, engineer } = await fixture();
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/tickets/${ticketId}/events`,
      headers: { cookie: engineer },
    });
    expect(response.statusCode).toBe(403);
  });

  it('повторяет разбор по запросу диспетчера', async () => {
    const { ctx, ticketId, dispatcher } = await fixture();
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/tickets/${ticketId}/reanalyze`,
      headers: { cookie: dispatcher },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { runId: string; ticketId: string };
    expect(body.ticketId).toBe(ticketId);
    const ticket = await ctx.app.inject({
      method: 'GET',
      url: `/api/tickets/${ticketId}`,
      headers: { cookie: dispatcher },
    });
    const details = ticket.json() as { steps: { stepId: string }[] };
    expect(details.steps.length).toBeGreaterThan(3);
  });
});

describe('уведомления', () => {
  it('уведомляет исполнителя о назначении и отмечает прочитанным', async () => {
    const { ctx, ticketId, dispatcher, engineer } = await fixture();
    await ctx.app.inject({
      method: 'POST',
      url: `/api/tickets/${ticketId}/confirm`,
      headers: { cookie: dispatcher },
      payload: { assigneeId: 'u-engineer-1' },
    });
    const list = await ctx.app.inject({
      method: 'GET',
      url: '/api/notifications',
      headers: { cookie: engineer },
    });
    expect(list.statusCode).toBe(200);
    const notifications = (list.json() as { notifications: { id: string; readAt: string | null }[] }).notifications;
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.readAt).toBeNull();
    const read = await ctx.app.inject({
      method: 'POST',
      url: `/api/notifications/${notifications[0]?.id}/read`,
      headers: { cookie: engineer },
    });
    expect(read.statusCode).toBe(200);
    expect((read.json() as { readAt: string | null }).readAt).not.toBeNull();
  });

  it('не отдаёт уведомления без входа', async () => {
    const { ctx } = await fixture();
    const response = await ctx.app.inject({ method: 'GET', url: '/api/notifications' });
    expect(response.statusCode).toBe(401);
  });

  it('чужое уведомление прочитать нельзя', async () => {
    const { ctx, ticketId, dispatcher, applicant } = await fixture();
    await ctx.app.inject({
      method: 'POST',
      url: `/api/tickets/${ticketId}/confirm`,
      headers: { cookie: dispatcher },
      payload: { assigneeId: 'u-engineer-1' },
    });
    const list = await ctx.app.inject({ method: 'GET', url: '/api/notifications', headers: { cookie: applicant } });
    const notifications = (list.json() as { notifications: { toUserId: string }[] }).notifications;
    // Заявитель видит только свои уведомления (например, «заявка принята»), чужие — нет.
    expect(notifications.every((item) => item.toUserId === 'u-applicant-1')).toBe(true);
  });
});

describe('настройки', () => {
  it('руководитель читает и меняет порог уверенности', async () => {
    const { ctx, manager } = await fixture();
    const list = await ctx.app.inject({ method: 'GET', url: '/api/settings', headers: { cookie: manager } });
    expect(list.statusCode).toBe(200);
    const updated = await ctx.app.inject({
      method: 'PUT',
      url: '/api/settings/confidenceThreshold',
      headers: { cookie: manager },
      payload: { value: 0.8 },
    });
    expect(updated.statusCode).toBe(200);
    const record = updated.json() as { key: string; value: number; updatedBy: string };
    expect(record.value).toBe(0.8);
    expect(record.updatedBy).toBe('u-manager-1');
  });

  it('руководитель не меняет чужие настройки', async () => {
    const { ctx, manager } = await fixture();
    const response = await ctx.app.inject({
      method: 'PUT',
      url: '/api/settings/massThreshold',
      headers: { cookie: manager },
      payload: { value: 10 },
    });
    expect(response.statusCode).toBe(403);
  });

  it('диспетчер не имеет доступа к настройкам', async () => {
    const { ctx, dispatcher } = await fixture();
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/settings',
      headers: { cookie: dispatcher },
    });
    expect(response.statusCode).toBe(403);
  });
});
