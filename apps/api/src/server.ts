import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import type { z } from 'zod';
import {
  CreateAppealInput,
  HealthResponse,
  PriorityLevel,
  Role,
  SessionInput,
  SessionResponse,
  TicketListQuery,
  TicketResponse,
  type Appeal,
  type DictionaryItem,
  type Permission,
  type RunStreamEvent,
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
  const engine = new PipelineEngine({
    bus,
    ports: options.ports,
    data,
    steps: [...coreSteps(), ...registries.steps],
    store: options.store,
    mode: env.AI_MODE ?? 'stub',
    onProgress: (progress) => hub.publish(progress),
  });

  const app = Fastify({ logger: options.logger ?? false });
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

  registerCoreRoutes(addRoute, options.store, ctx, data, env);

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
      aiMode: (env.AI_MODE ?? 'stub') as 'stub' | 'cloud' | 'cache-only',
      roles: [...Role.options],
      priorities: [...PriorityLevel.options],
    }),
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
}

function registerStreamRoute(ctx: AppContext, store: KernelStore): void {
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

