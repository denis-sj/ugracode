import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import type { z } from 'zod';
import {
  AppealMessagesResponse,
  ConfirmTicketInput,
  CreateAppealInput,
  DeadlineInput,
  HealthResponse,
  NotificationsResponse,
  PostAppealMessageInput,
  PostAppealMessageResponse,
  PriorityLevel,
  ReanalyzeResponse,
  ResolutionInput,
  Role,
  ScreenshotInput,
  ScreenshotResponse,
  SessionInput,
  SessionResponse,
  SettingsResponse,
  TicketAnalysisResponse,
  TicketField,
  TicketListQuery,
  TicketResponse,
  TranscribeInput,
  TranscribeResponse,
  TransitionInput,
  UpdateFieldInput,
  UpdateSettingInput,
  type Appeal,
  type AppealMessage,
  type DictionaryItem,
  type Permission,
  type RunStreamEvent,
  type Ticket,
  type TicketStatus,
  type User,
} from '@ugra/contracts';
import { hasPermission } from '@ugra/contracts';
import {
  KernelEventBus,
  PipelineEngine,
  TicketService,
  buildRegistries,
  collectRoutes,
  coreSteps,
  createSettingsService,
  findField,
  missingFields,
  resolveEnabledModules,
  subscribeModules,
  type KernelStore,
  type ModuleDeps,
  type Ports,
  type ReferenceData,
  type ServerModule,
} from '@ugra/core';
import { serverModules } from '../../../modules/registry.server';
import { resolveRequestUser, sessionCookieHeader } from './auth';
import { canSeeEvent } from './event-access';
import { ProgressHub } from './hub';

export interface BuildServerOptions {
  store: KernelStore;
  ports: Ports;
  data: ReferenceData;
  modules?: readonly ServerModule[];
  env?: Record<string, string | undefined>;
  logger?: boolean;
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

interface RouteContext {
  body: unknown;
  params: Record<string, string>;
  query: Record<string, unknown>;
  user: User | null;
  setCookie(value: string): void;
}

interface RouteDef {
  method: Method;
  url: string;
  access: Permission;
  body?: z.ZodType;
  response?: z.ZodType;
  handler(ctx: RouteContext): Promise<unknown>;
}

export interface AppContext {
  app: FastifyInstance;
  store: KernelStore;
  tickets: TicketService;
  engine: PipelineEngine;
  bus: KernelEventBus;
  hub: ProgressHub;
  modules: ServerModule[];
}

function modulesOf(options: BuildServerOptions): readonly ServerModule[] {
  return options.modules ?? serverModules;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function effectiveAiMode(env: Record<string, string | undefined>): 'stub' | 'cloud' {
  if (env.AI_MODE === 'stub') return 'stub';
  return env.POLZA_API_KEY ? 'cloud' : 'stub';
}

function httpError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

function requireUser(user: User | null): User {
  if (!user) throw httpError('Нужен вход', 401);
  return user;
}

/** Шаг, который пишет след ответа в поле: видно, откуда значение. */
const ANSWER_STEP = 'clarify-chat.answer';

/** Промпт распознавания картинки: тот же файл, что у агента `vision`. */
const SCREENSHOT_PROMPT_ID = 'modules/screenshot/prompts/read.v1.md';

/** `data:image/png;base64,AAAA` → `AAAA`; обычный base64 возвращается как есть. */
function stripImagePrefix(image: string): string {
  const comma = image.indexOf(',');
  return image.startsWith('data:') && comma >= 0 ? image.slice(comma + 1) : image;
}

/** Base64 картинки: пустая строка, мусорные символы и нулевая длина — 400. */
function isBase64Image(image: string): boolean {
  const compact = image.replace(/\s+/g, '');
  if (compact === '' || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return false;
  return Buffer.from(compact, 'base64').length > 0;
}

async function requireAppeal(store: KernelStore, id: string | undefined): Promise<Appeal> {
  const appeal = await store.getAppeal(id ?? '');
  if (!appeal) throw httpError('Обращение не найдено', 404);
  return appeal;
}

/** Чат обращения видят автор и диспетчер (админ — как диспетчер), остальным — 403. */
function assertAppealAccess(actor: User, appeal: Appeal): void {
  if (actor.role === 'dispatcher' || actor.role === 'admin') return;
  if (appeal.authorId !== actor.id) throw httpError('Чужое обращение', 403);
}

async function ticketOfAppeal(store: KernelStore, appealId: string): Promise<Ticket | null> {
  const tickets = await store.listTickets({ limit: 1000 });
  return tickets.find((ticket) => ticket.appealId === appealId) ?? null;
}

/** «Не знаю» в любом виде: `unknown` или текст, начинающийся с «не знаю». */
function isUnknownAnswer(body: string): boolean {
  const normalized = body.trim().toLowerCase();
  return normalized === 'unknown' || normalized.startsWith('не знаю') || normalized.startsWith('незнаю');
}

/** Поля, которые заявка уже знала: рерун с `validate` не должен их потерять. */
function restoreFields(current: readonly TicketField[], previous: readonly TicketField[]): TicketField[] {
  const byKey = new Map(current.map((field) => [field.fieldKey, field]));
  for (const field of previous) byKey.set(field.fieldKey, field);
  return [...byKey.values()];
}

/** Статус из цепочки разбора; закрытую или назначенную заявку не трогаем. */
async function setAnalysisStatus(
  store: KernelStore,
  ticketId: string,
  to: TicketStatus,
  at: string,
): Promise<void> {
  const ticket = await store.getTicket(ticketId);
  if (!ticket || ticket.status === to) return;
  if (!['new', 'ai_draft', 'waiting_applicant', 'in_review'].includes(ticket.status)) return;
  await store.updateTicket(ticketId, { status: to, updatedAt: at });
}

interface AnswerInput {
  ctx: AppContext;
  store: KernelStore;
  data: ReferenceData;
  appeal: Appeal;
  ticket: Ticket;
  message: AppealMessage;
  actor: User;
  at: string;
}

/**
 * Ответ на карточку: поле с `origin: asked` и следом «спросили → ответил» (или `no_answer`),
 * повторный разбор с `validate` и перенос итога в заявку. Возвращает id прогона.
 */
async function applyAnswer(input: AnswerInput): Promise<string> {
  const { ctx, store, data, appeal, ticket, message, actor, at } = input;
  const fieldKey = message.fieldKey ?? '';
  const unknown = isUnknownAnswer(message.body);
  const topic = { kind: 'user' as const, id: actor.id };
  const before = await store.getTicketFields(ticket.id);
  const previous = before.find((field) => field.fieldKey === fieldKey);
  const answered: TicketField = {
    ticketId: ticket.id,
    fieldKey,
    value: unknown ? null : message.body,
    confidence: unknown ? 0 : 1,
    quote: null,
    origin: 'asked',
    needsReview: unknown,
    trace: [
      ...(previous?.trace ?? []),
      { kind: 'asked', step: ANSWER_STEP, at, note: message.body },
      { kind: unknown ? 'no_answer' : 'answered', step: ANSWER_STEP, at, note: message.body },
    ],
    aiValue: previous?.aiValue ?? previous?.value ?? null,
  };
  const answeredFields = [...before.filter((field) => field.fieldKey !== fieldKey), answered];
  await store.saveTicketFields(ticket.id, answeredFields);
  await ctx.bus.publish({
    type: 'ticket.field.set',
    actor: topic,
    ticketId: ticket.id,
    payload: { fieldKey, value: answered.value, origin: answered.origin, needsReview: answered.needsReview },
  });

  const run = await ctx.engine.rerun(appeal, 'validate', { ticketId: ticket.id, actor: topic });
  await ctx.tickets.applyAnalysis(ticket.id, run.draft, topic);
  // Рерун начинается с пустого черновика и перезаписывает поля заявки — возвращаем ответы на место.
  const after = await store.getTicketFields(ticket.id);
  const restored = restoreFields(after, answeredFields);
  await store.saveTicketFields(ticket.id, restored);

  if (unknown) {
    await setAnalysisStatus(store, ticket.id, 'in_review', at);
    return run.runId;
  }
  const values: Record<string, { value: unknown }> = {};
  for (const field of restored) values[field.fieldKey] = { value: field.value };
  if (missingFields(data.fields, values).length > 0) {
    await setAnalysisStatus(store, ticket.id, 'waiting_applicant', at);
  }
  return run.runId;
}

export async function buildServer(options: BuildServerOptions): Promise<AppContext> {
  const env = options.env ?? process.env;
  const clock = options.ports.clock;
  const hub = new ProgressHub();
  const { enabled } = resolveEnabledModules(modulesOf(options), {
    FEATURES_OFF: env.FEATURES_OFF,
    FEATURES_ON: env.FEATURES_ON,
  });
  const registries = buildRegistries(enabled, options.data.fields);
  const data: ReferenceData = { ...options.data, fields: registries.fields };
  const bus = new KernelEventBus(options.store);
  const tickets = new TicketService({ store: options.store, bus, clock, fields: registries.fields });
  const settings = createSettingsService({ settings: data.settings });
  const deps: ModuleDeps = {
    bus,
    ports: options.ports,
    data,
    db: options.store,
    tickets,
    settings,
    clock,
  };
  subscribeModules(enabled, bus, deps);
  subscribeNotifications(bus, options.store, options.ports, clock);
  const engine = new PipelineEngine({
    bus,
    ports: options.ports,
    data,
    steps: [...coreSteps(), ...registries.steps],
    store: options.store,
    mode: env.AI_MODE ?? 'stub',
    tools: registries.tools,
    onProgress: (progress) => hub.publish(progress),
  });

  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 25 * 1024 * 1024 });
  const ctx: AppContext = { app, store: options.store, tickets, engine, bus, hub, modules: enabled };

  const addRoute = (def: RouteDef): void => {
    app.route({
      method: def.method,
      url: def.url,
      handler: async (request, reply) => {
        const user = await resolveRequestUser(request, options.store);
        if (def.access !== 'any') {
          if (!user) return reply.code(401).send({ error: 'unauthorized', message: 'Нужен вход' });
          if (!hasPermission(user.role, def.access)) {
            return reply.code(403).send({ error: 'forbidden', message: `Нет права ${def.access}` });
          }
        }
        let body: unknown = request.body ?? {};
        if (def.body) {
          const parsed = def.body.safeParse(body);
          if (!parsed.success) {
            return reply.code(400).send({ error: 'validation', message: parsed.error.message });
          }
          body = parsed.data;
        }
        const result = await def.handler({
          body,
          params: asRecord(request.params) as Record<string, string>,
          query: asRecord(request.query),
          user,
          setCookie: (value: string) => reply.header('set-cookie', value),
        });
        if (!def.response) return reply.send(result);
        const parsed = def.response.safeParse(result);
        if (!parsed.success) {
          request.log.error({ issues: parsed.error.issues }, 'ответ не соответствует схеме');
          return reply.code(500).send({ error: 'contract', message: 'Ответ не соответствует схеме' });
        }
        return reply.send(parsed.data);
      },
    });
  };

  registerCoreRoutes(addRoute, options.store, ctx, data, env, options.ports);

  for (const mounted of collectRoutes(enabled, deps)) {
    for (const route of mounted.routes) {
      addRoute({
        method: route.method,
        url: `/api/m/${mounted.moduleId}${route.path}`,
        access: route.access,
        body: route.body,
        response: route.response,
        handler: (routeCtx) =>
          Promise.resolve(
            route.handler({
              body: routeCtx.body,
              params: routeCtx.params,
              query: routeCtx.query as Record<string, string>,
              user: routeCtx.user as User,
              deps,
            }),
          ),
      });
    }
  }

  registerStreamRoute(ctx, options.store);
  return ctx;
}

function registerCoreRoutes(
  addRoute: (def: RouteDef) => void,
  store: KernelStore,
  ctx: AppContext,
  data: ReferenceData,
  env: Record<string, string | undefined>,
  ports: Ports,
): void {
  const { tickets, engine } = ctx;
  addRoute({
    method: 'GET',
    url: '/api/health',
    access: 'any',
    response: HealthResponse,
    handler: async () => ({ status: 'ok', service: 'api' }),
  });

  addRoute({
    method: 'GET',
    url: '/api/meta',
    access: 'any',
    handler: async () => ({
      modules: ctx.modules.map((module) => ({ id: module.id, title: module.title })),
      fields: data.fields,
      dictionaries: data.dictionaries as DictionaryItem[],
      aiMode: effectiveAiMode(env),
      roles: [...Role.options],
      priorities: [...PriorityLevel.options],
    }),
  });

  addRoute({
    method: 'POST',
    url: '/api/transcribe',
    access: 'any',
    body: TranscribeInput,
    response: TranscribeResponse,
    handler: async ({ body, user }) => {
      requireUser(user);
      const input = body as { audio: string; mimeType: string };
      try {
        const transcript = await ports.speech.transcribe({
          kind: 'audio',
          data: input.audio,
          mimeType: input.mimeType,
        });
        return { text: transcript.text, language: transcript.language, confidence: transcript.confidence };
      } catch {
        throw httpError('Не удалось распознать речь', 502);
      }
    },
  });

  addRoute({
    method: 'POST',
    url: '/api/screenshot',
    access: 'appeal.create',
    body: ScreenshotInput,
    response: ScreenshotResponse,
    handler: async ({ body, user }) => {
      requireUser(user);
      const input = body as { image: string; mimeType: string };
      const data = stripImagePrefix(input.image.trim());
      if (!isBase64Image(data)) throw httpError('Битая картинка: нужен base64', 400);
      let described;
      try {
        described = await ports.vision.describe(
          { kind: 'image', data, mimeType: input.mimeType },
          SCREENSHOT_PROMPT_ID,
        );
      } catch {
        throw httpError('Не удалось распознать изображение', 502);
      }
      const text = described.text.trim();
      if (text === '') throw httpError('На изображении нечего распознать', 502);
      return { text, confidence: described.confidence };
    },
  });

  addRoute({
    method: 'GET',
    url: '/api/users',
    access: 'any',
    handler: async () => ({ users: await store.listUsers() }),
  });

  addRoute({
    method: 'POST',
    url: '/api/session',
    access: 'any',
    body: SessionInput,
    response: SessionResponse,
    handler: async ({ body, setCookie }) => {
      const input = body as { userId: string };
      const found = await store.getUser(input.userId);
      if (!found) throw Object.assign(new Error('Пользователь не найден'), { statusCode: 404 });
      setCookie(sessionCookieHeader(found.id));
      return { user: found };
    },
  });

  addRoute({
    method: 'GET',
    url: '/api/session',
    access: 'any',
    handler: async ({ user }) => {
      if (!user) throw Object.assign(new Error('Нужен вход'), { statusCode: 401 });
      return { user };
    },
  });

  addRoute({
    method: 'POST',
    url: '/api/appeals',
    access: 'appeal.create',
    body: CreateAppealInput,
    handler: async ({ body, user }) => {
      const input = body as { text: string; channel: Appeal['channel']; attachments: string[] };
      if (!user) throw new Error('Нужен вход');
      const appeal: Appeal = {
        id: randomUUID(),
        channel: input.channel,
        authorId: user.id,
        originalText: input.text,
        attachments: input.attachments,
        createdAt: new Date().toISOString(),
      };
      await store.saveAppeal(appeal);
      await ctx.bus.publish({
        type: 'appeal.created',
        actor: { kind: 'user', id: user.id },
        payload: { appealId: appeal.id, channel: appeal.channel },
      });
      const ticket = await tickets.createDraft(appeal);
      await tickets.transition(ticket.id, 'ai_draft', { kind: 'system' });
      const run = await engine.run(appeal, { ticketId: ticket.id, actor: { kind: 'ai' } });
      await tickets.applyAnalysis(ticket.id, run.draft);
      return { appealId: appeal.id, ticketId: ticket.id, runId: run.runId };
    },
  });

  addRoute({
    method: 'GET',
    url: '/api/appeals/:id/messages',
    access: 'appeal.answer',
    response: AppealMessagesResponse,
    handler: async ({ params, user }) => {
      const actor = requireUser(user);
      const appeal = await requireAppeal(store, params.id);
      assertAppealAccess(actor, appeal);
      return { messages: await store.listAppealMessages(appeal.id) };
    },
  });

  addRoute({
    method: 'POST',
    url: '/api/appeals/:id/messages',
    access: 'appeal.answer',
    body: PostAppealMessageInput,
    response: PostAppealMessageResponse,
    handler: async ({ params, body, user }) => {
      const actor = requireUser(user);
      const appeal = await requireAppeal(store, params.id);
      assertAppealAccess(actor, appeal);
      const input = body as PostAppealMessageInput;
      const text = input.body.trim();
      if (text === '') throw httpError('Пустое сообщение', 400);
      if (input.fieldKey && !findField(data, input.fieldKey)) {
        throw httpError(`Поле «${input.fieldKey}» не найдено в реестре`, 400);
      }
      const ticket = await ticketOfAppeal(store, appeal.id);
      if (!ticket) throw httpError('Заявка не найдена', 404);

      const at = ports.clock.now().toISOString();
      const message: AppealMessage = {
        id: randomUUID(),
        appealId: appeal.id,
        direction: 'in',
        kind: input.kind,
        body: text,
        fieldKey: input.fieldKey ?? null,
        ...(input.card ? { card: input.card } : {}),
        createdAt: at,
      };
      await store.saveAppealMessage(message);
      await ctx.bus.publish({
        type: 'message.sent',
        actor: { kind: 'user', id: actor.id },
        ticketId: ticket.id,
        payload: {
          appealId: appeal.id,
          messageId: message.id,
          kind: message.kind,
          fieldKey: message.fieldKey,
        },
      });

      const runId =
        message.kind === 'answer' && message.fieldKey
          ? await applyAnswer({ ctx, store, data, appeal, ticket, message, actor, at })
          : null;
      return { message, ticketId: ticket.id, runId };
    },
  });

  addRoute({
    method: 'GET',
    url: '/api/tickets',
    access: 'tickets.read',
    handler: async ({ query, user }) => {
      const parsed = TicketListQuery.parse(query);
      const list = await store.listTickets(parsed);
      if (user?.role !== 'applicant') return { tickets: list };
      const visible = [];
      for (const ticket of list) {
        const appeal = await store.getAppeal(ticket.appealId);
        if (appeal?.authorId === user.id) visible.push(ticket);
      }
      return { tickets: visible };
    },
  });

  addRoute({
    method: 'GET',
    url: '/api/tickets/:id',
    access: 'tickets.read',
    response: TicketResponse,
    handler: async ({ params, user }) => {
      const ticket = await store.getTicket(params.id ?? '');
      if (!ticket) throw Object.assign(new Error('Заявка не найдена'), { statusCode: 404 });
      const appeal = await store.getAppeal(ticket.appealId);
      if (!appeal) throw Object.assign(new Error('Обращение не найдено'), { statusCode: 404 });
      if (user?.role === 'applicant' && appeal.authorId !== user.id) {
        throw Object.assign(new Error('Чужая заявка'), { statusCode: 403 });
      }
      const [fields, steps, events] = await Promise.all([
        store.getTicketFields(ticket.id),
        store.listPipelineSteps({ ticketId: ticket.id }),
        store.listEvents({ ticketId: ticket.id, limit: 200 }),
      ]);
      return {
        ticket,
        appeal,
        fields,
        steps,
        events: events.map((event) => ({ ...event, payload: event.payload })),
      };
    },
  });

  addRoute({
    method: 'PATCH',
    url: '/api/tickets/:id/fields/:key',
    access: 'tickets.edit',
    body: UpdateFieldInput,
    response: TicketField,
    handler: async ({ params, body, user }) => {
      const actor = requireUser(user);
      const input = body as { value: string | number | null };
      try {
        return await tickets.setField(params.id ?? '', params.key ?? '', input.value, {
          kind: 'user',
          id: actor.id,
        });
      } catch (error) {
        throw httpError(error instanceof Error ? error.message : 'Не удалось изменить поле', 404);
      }
    },
  });

  addRoute({
    method: 'POST',
    url: '/api/tickets/:id/confirm',
    access: 'tickets.confirm',
    body: ConfirmTicketInput,
    handler: async ({ params, body, user }) => {
      const actor = requireUser(user);
      const input = body as { assigneeId: string };
      const assignee = await store.getUser(input.assigneeId);
      if (!assignee || assignee.role !== 'engineer') throw httpError('Исполнитель не найден', 400);
      return tickets.confirm(params.id ?? '', input.assigneeId, { kind: 'user', id: actor.id }, actor.role);
    },
  });

  addRoute({
    method: 'POST',
    url: '/api/tickets/:id/transition',
    access: 'tickets.transition',
    body: TransitionInput,
    handler: async ({ params, body, user }) => {
      const actor = requireUser(user);
      const input = body as { to: Parameters<typeof tickets.transition>[1]; reason?: string };
      try {
        return await tickets.transition(
          params.id ?? '',
          input.to,
          { kind: 'user', id: actor.id },
          actor.role,
          input.reason,
        );
      } catch (error) {
        throw httpError(error instanceof Error ? error.message : 'Переход запрещён', 403);
      }
    },
  });

  addRoute({
    method: 'POST',
    url: '/api/tickets/:id/reanalyze',
    access: 'tickets.edit',
    response: ReanalyzeResponse,
    handler: async ({ params, user }) => {
      const actor = requireUser(user);
      const ticket = await store.getTicket(params.id ?? '');
      if (!ticket) throw httpError('Заявка не найдена', 404);
      const appeal = await store.getAppeal(ticket.appealId);
      if (!appeal) throw httpError('Обращение не найдено', 404);
      const run = await engine.run(appeal, { ticketId: ticket.id, actor: { kind: 'user', id: actor.id } });
      await tickets.applyAnalysis(ticket.id, run.draft, { kind: 'user', id: actor.id });
      return { runId: run.runId, ticketId: ticket.id };
    },
  });

  addRoute({
    method: 'GET',
    url: '/api/tickets/:id/analysis',
    access: 'tickets.read',
    response: TicketAnalysisResponse,
    handler: async ({ params, user }) => {
      const ticket = await store.getTicket(params.id ?? '');
      if (!ticket) throw httpError('Заявка не найдена', 404);
      const appeal = await store.getAppeal(ticket.appealId);
      if (user?.role === 'applicant' && appeal?.authorId !== user.id) {
        throw httpError('Чужая заявка', 403);
      }
      const events = await store.listEvents({ ticketId: ticket.id, type: 'analysis.completed', limit: 20 });
      const last = events.at(-1);
      const payload = asRecord(last?.payload);
      const analysis = asRecord(payload.draft);
      if (!last || Object.keys(analysis).length === 0) throw httpError('Разбор не найден', 404);
      return {
        ticketId: ticket.id,
        runId: typeof payload.runId === 'string' ? payload.runId : '',
        analysis,
      };
    },
  });

  addRoute({
    method: 'POST',
    url: '/api/tickets/:id/deadline',
    // Срок продлевает и диспетчер, и инженер по своей заявке.
    access: 'tickets.transition',
    body: DeadlineInput,
    handler: async ({ params, body, user }) => {
      const actor = requireUser(user);
      const input = body as { slaDueAt: string; reason: string };
      return tickets.extendDeadline(params.id ?? '', input.slaDueAt, input.reason, {
        kind: 'user',
        id: actor.id,
      });
    },
  });

  addRoute({
    method: 'POST',
    url: '/api/tickets/:id/resolution',
    access: 'tickets.transition',
    body: ResolutionInput,
    handler: async ({ params, body, user }) => {
      const actor = requireUser(user);
      const input = body as { text: string };
      try {
        return await tickets.resolve(params.id ?? '', input.text, { kind: 'user', id: actor.id }, actor.role);
      } catch (error) {
        throw httpError(error instanceof Error ? error.message : 'Не удалось сохранить результат', 403);
      }
    },
  });

  addRoute({
    method: 'GET',
    url: '/api/tickets/:id/events',
    access: 'tickets.events',
    handler: async ({ params }) => ({
      events: await store.listEvents({ ticketId: params.id ?? '', limit: 500 }),
    }),
  });

  addRoute({
    method: 'GET',
    url: '/api/notifications',
    access: 'any',
    response: NotificationsResponse,
    handler: async ({ user }) => {
      const actor = requireUser(user);
      return { notifications: await store.listNotifications(actor.id) };
    },
  });

  addRoute({
    method: 'POST',
    url: '/api/notifications/:id/read',
    access: 'any',
    handler: async ({ params, user }) => {
      const actor = requireUser(user);
      const updated = await store.markNotificationRead(params.id ?? '', actor.id);
      if (!updated) throw httpError('Уведомление не найдено', 404);
      return updated;
    },
  });

  addRoute({
    method: 'GET',
    url: '/api/settings',
    access: 'settings',
    response: SettingsResponse,
    handler: async () => ({ settings: await store.listSettings() }),
  });

  addRoute({
    method: 'PUT',
    url: '/api/settings/:key',
    access: 'settings',
    body: UpdateSettingInput,
    handler: async ({ params, body, user }) => {
      const actor = requireUser(user);
      const key = params.key ?? '';
      if (actor.role === 'manager' && key !== 'confidenceThreshold') {
        throw httpError('Руководитель может менять только порог уверенности', 403);
      }
      const input = body as { value: unknown };
      const record = await store.setSetting(key, input.value, actor.id);
      data.settings[key] = input.value;
      await ctx.bus.publish({
        type: 'setting.changed',
        actor: { kind: 'user', id: actor.id },
        payload: { key, value: input.value },
      });
      return record;
    },
  });
}

function registerStreamRoute(ctx: AppContext, store: KernelStore): void {
  /** Живой поток доменных событий для экранов: фильтр по роли и заявке. */
  ctx.app.get('/api/events/stream', async (request, reply) => {
    const user = await resolveRequestUser(request, store);
    if (!user) return reply.code(401).send({ error: 'unauthorized', message: 'Нужен вход' });
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.hijack();
    let closed = false;
    const send = (event: unknown): void => {
      if (!closed) reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    const heartbeat = setInterval(() => {
      if (!closed) reply.raw.write(': ping\n\n');
    }, 25000);
    const unsubscribe = ctx.bus.subscribe('*', async (event) => {
      const ticket = event.ticketId ? await store.getTicket(event.ticketId) : null;
      const appeal = ticket ? await store.getAppeal(ticket.appealId) : null;
      const info = ticket
        ? { ticketId: ticket.id, assignedTo: ticket.assigneeId, authorId: appeal?.authorId ?? null }
        : null;
      if (canSeeEvent(user, event, info)) send(event);
    });
    request.raw.on('close', () => {
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
    });
    return reply;
  });

  ctx.app.get('/api/appeals/:id/stream', async (request, reply) => {
    const user = await resolveRequestUser(request, store);
    if (!user) return reply.code(401).send({ error: 'unauthorized', message: 'Нужен вход' });
    const params = request.params as { id?: string };
    const appeal = await store.getAppeal(params.id ?? '');
    if (!appeal) return reply.code(404).send({ error: 'not_found', message: 'Обращение не найдено' });
    if (!hasPermission(user.role, 'tickets.read')) {
      return reply.code(403).send({ error: 'forbidden', message: 'Нет доступа' });
    }
    if (user.role === 'applicant' && appeal.authorId !== user.id) {
      return reply.code(403).send({ error: 'forbidden', message: 'Чужое обращение' });
    }
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.hijack();
    let closed = false;
    const send = (event: RunStreamEvent): void => {
      if (closed) return;
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    const unsubscribe = ctx.hub.subscribe(appeal.id, (event) => {
      send(event);
      if (event.type === 'run.completed' || event.type === 'run.failed') {
        unsubscribe();
        if (!closed) {
          closed = true;
          reply.raw.end();
        }
      }
    });
    for (const event of ctx.hub.history(appeal.id)) send(event);
    if (ctx.hub.isFinished(appeal.id)) {
      unsubscribe();
      if (!closed) {
        closed = true;
        reply.raw.end();
      }
      return;
    }
    request.raw.on('close', () => {
      unsubscribe();
      closed = true;
    });
    return reply;
  });

}


/** Уведомление исполнителю при назначении заявки: в журнал, в интерфейс и через порт. */
function subscribeNotifications(
  bus: KernelEventBus,
  store: KernelStore,
  ports: Ports,
  clock: { now(): Date },
): void {
  bus.subscribe('ticket.assigned', async (event) => {
    const payload = asRecord(event.payload);
    const assigneeId = typeof payload.assigneeId === 'string' ? payload.assigneeId : null;
    if (!assigneeId || !event.ticketId) return;
    const assignee = await store.getUser(assigneeId);
    const ticket = await store.getTicket(event.ticketId);
    if (!assignee || !ticket) return;
    const notification = {
      id: randomUUID(),
      toUserId: assignee.id,
      channel: 'inapp' as const,
      title: 'Назначена заявка',
      body: `Заявка ${ticket.number}: ${ticket.category ?? 'без категории'}`,
      ticketId: ticket.id,
      readAt: null,
      createdAt: clock.now().toISOString(),
    };
    await store.saveNotification(notification);
    try {
      await ports.notifications.send({
        toUserId: assignee.id,
        channel: 'inapp',
        title: notification.title,
        body: notification.body,
        ticketId: ticket.id,
      });
    } catch {
      // канал уведомлений — заглушка; ошибка не должна ломать назначение
    }
  });
}
