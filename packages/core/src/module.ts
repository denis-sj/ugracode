import type { z } from 'zod';
import type {
  Actor,
  Appeal,
  DomainEvent,
  EventDef,
  FieldDef,
  Permission,
  User,
} from '@ugra/contracts';
import type { ReferenceData } from './data';
import type { ModuleRouteInput } from './router';
import type { PipelineStep } from './types';
import type { ExtractionAspect, ReportDef } from './reports';
import type { KernelStore } from './storage';
import type { Ports } from './ports';
import type { TicketService } from './tickets';
import type { AgentProfile, ToolDef } from './agent';

/** Итог приёма обращения: заявка создана, разбор запущен (`wait: false` — прогон идёт в фоне, `runId` уже известен). */
export interface AppealSubmitResult {
  appealId: string;
  ticketId: string;
  ticketNumber: string;
  runId: string | null;
}

export interface AppealSubmitOptions {
  /** Кто подал обращение; по умолчанию — система. */
  actor?: Actor;
  /**
   * `true` (по умолчанию) — дождаться разбора, как `POST /api/appeals`.
   * `false` — вернуть заявку сразу после черновика, разбор идёт в фоне (звонок не ждёт 20 с).
   */
  wait?: boolean;
}

/**
 * Приём обращения из модуля: тот же путь, что `POST /api/appeals` — сохранить обращение,
 * событие `appeal.created`, черновик заявки, пайплайн разбора, перенос итога в заявку.
 */
export interface AppealIntake {
  submit(appeal: Appeal, options?: AppealSubmitOptions): Promise<AppealSubmitResult>;
}

export interface ModuleDeps {
  /** Приём обращений из модуля (звонок, почта). Даёт сервер приложения; в тестах модулей может отсутствовать. */
  appeals?: AppealIntake;
  bus: { publish(event: Omit<DomainEvent, 'id' | 'at'> & { id?: string; at?: string }): Promise<void> };
  ports: Ports;
  data: ReferenceData;
  db: KernelStore;
  tickets: TicketService;
  settings: { get<T = unknown>(key: string): Promise<T | undefined> };
  clock: { now(): Date };
}

export interface SeedDeps {
  db: KernelStore;
  data: ReferenceData;
  clock: { now(): Date };
}

export interface Subscriber {
  on: string;
  handle(event: DomainEvent, deps: ModuleDeps): Promise<void> | void;
}

export interface ModuleRouter {
  add(route: ModuleRouteInput): void;
  get(path: string, access: Permission, handler: ModuleHandler, schemas?: RouteSchemas): void;
  post(path: string, access: Permission, handler: ModuleHandler, schemas?: RouteSchemas): void;
  patch(path: string, access: Permission, handler: ModuleHandler, schemas?: RouteSchemas): void;
}

export interface RouteSchemas {
  body?: z.ZodType;
  response?: z.ZodType;
}

export type ModuleHandler = (ctx: {
  body: unknown;
  params: Record<string, string>;
  query: Record<string, string>;
  /** Заголовки запроса в нижнем регистре (например, `x-forwarded-for` для лимита частоты). Сервер передаёт всегда. */
  headers?: Readonly<Record<string, string>>;
  user: User;
  deps: ModuleDeps;
}) => Promise<unknown> | unknown;

/** Описание серверной части модуля: одна строка регистрации в `modules/registry.server.ts`. */
export interface ServerModule {
  id: string;
  title: string;
  enabledByDefault: boolean;
  fields: FieldDef[];
  steps: PipelineStep[];
  aspects: Record<string, z.ZodType>;
  events: EventDef[];
  subscribers: Subscriber[];
  routes?: (router: ModuleRouter, deps: ModuleDeps) => void;
  reports: ReportDef[];
  /** Инструменты агентов: новый инструмент = запись в модуле, ядро не правится. */
  tools: ToolDef[];
  /** Профили агентов модуля. */
  agents: AgentProfile[];
  seed?: (deps: SeedDeps) => Promise<void>;
}

export interface ModuleDefinition {
  id: string;
  title: string;
  enabledByDefault: boolean;
  fields?: FieldDef[];
  steps?: PipelineStep[];
  aspects?: Record<string, z.ZodType>;
  events?: EventDef[];
  subscribers?: Subscriber[];
  routes?: (router: ModuleRouter, deps: ModuleDeps) => void;
  reports?: ReportDef[];
  tools?: ToolDef[];
  agents?: AgentProfile[];
  seed?: (deps: SeedDeps) => Promise<void>;
}

export function defineModule(definition: ModuleDefinition): ServerModule {
  if (!definition.id || !/^[a-z][a-z0-9-]*$/.test(definition.id)) {
    throw new Error(`Некорректный id модуля: ${definition.id}`);
  }
  return {
    id: definition.id,
    title: definition.title,
    enabledByDefault: definition.enabledByDefault,
    fields: definition.fields ?? [],
    steps: definition.steps ?? [],
    aspects: definition.aspects ?? {},
    events: definition.events ?? [],
    subscribers: definition.subscribers ?? [],
    routes: definition.routes,
    reports: definition.reports ?? [],
    tools: definition.tools ?? [],
    agents: definition.agents ?? [],
    seed: definition.seed,
  };
}

export interface PageDef {
  path: string;
  title: string;
  icon?: string;
  roles: string[];
  component: unknown;
  nav?: { section: string; order: number };
}

export interface WidgetDef {
  slot: string;
  id: string;
  order: number;
  roles: string[];
  component: unknown;
}

export interface ChatCardDef {
  widget: string;
  component: unknown;
}

export interface ReportViewDef {
  reportId: string;
  component: unknown;
}

export interface WebModule {
  id: string;
  pages: PageDef[];
  widgets: WidgetDef[];
  chatCards: ChatCardDef[];
  reportViews: ReportViewDef[];
}

export interface WebModuleDefinition {
  id: string;
  pages?: PageDef[];
  widgets?: WidgetDef[];
  chatCards?: ChatCardDef[];
  reportViews?: ReportViewDef[];
}

export function defineWebModule(definition: WebModuleDefinition): WebModule {
  if (!definition.id || !/^[a-z][a-z0-9-]*$/.test(definition.id)) {
    throw new Error(`Некорректный id веб-модуля: ${definition.id}`);
  }
  return {
    id: definition.id,
    pages: definition.pages ?? [],
    widgets: definition.widgets ?? [],
    chatCards: definition.chatCards ?? [],
    reportViews: definition.reportViews ?? [],
  };
}

export type { ExtractionAspect };
