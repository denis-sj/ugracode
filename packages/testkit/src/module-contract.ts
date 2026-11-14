import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AnalysisDraft, Appeal, DraftKey, FieldDef } from '@ugra/contracts';
import { ROLE_PERMISSIONS, STAGES } from '@ugra/contracts';
import {
  buildRegistries,
  collectRoutes,
  coreSteps,
  KernelEventBus,
  MemoryStore,
  PipelineEngine,
  TicketService,
} from '@ugra/core';
import type {
  KernelStore,
  ModuleDeps,
  PipelineStep,
  Ports,
  ReferenceData,
  ServerModule,
} from '@ugra/core';
import { makeAppeal, makePorts, makeReferenceData } from './factories';

/**
 * Ключи черновика, которые модуль вправе читать, даже если их никто не записал:
 * они появляются из входа или могут остаться пустыми.
 *
 * `fields` сюда намеренно не входит: это продукт извлечения, и по разделу 10
 * спецификации `reads` каждого шага обязан кто-то записать раньше.
 */
const BASE_DRAFT_KEYS: readonly DraftKey[] = [
  'sources',
  'missing',
  'emergency',
  'incident',
  'priority',
  'assignees',
  'knowledge',
  'replyDraft',
  'ext',
];

export interface ModuleContractOptions {
  baseFields?: FieldDef[];
  /** Путь к README модуля; по умолчанию `modules/<id>/README.md` от cwd. */
  readmePath?: string;
  /** Корень файлов промптов; по умолчанию cwd. */
  promptRoot?: string;
  /** Обращение для проверок, которым нужен текст заявителя. */
  sampleAppeal?: Appeal;
}

export interface RunModuleContractOptions {
  modules: ServerModule[];
  appeal?: Appeal;
  referenceData?: ReferenceData;
  ports?: Ports;
}

function message(moduleId: string, text: string): string {
  return `Модуль ${moduleId}: ${text}`;
}

function ensure(moduleId: string, condition: unknown, text: string): asserts condition {
  assert(condition, message(moduleId, text));
}

function fail(moduleId: string, text: string): never {
  assert.fail(message(moduleId, text));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stepRank(step: PipelineStep): number {
  return STAGES.indexOf(step.stage);
}

function isZodSchema(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { safeParse?: unknown }).safeParse === 'function'
  );
}

function fakeDeps(data: ReferenceData, store: KernelStore, ports: Ports): ModuleDeps {
  const bus = new KernelEventBus(store);
  return {
    bus,
    ports,
    data,
    db: store,
    tickets: new TicketService({ store, bus, clock: ports.clock }),
    settings: {
      async get<T = unknown>(_key: string): Promise<T | undefined> {
        return undefined;
      },
    },
    clock: ports.clock,
  };
}

function assertSteps(module: ServerModule): void {
  const ordered = [...module.steps].sort(
    (a, b) => stepRank(a) - stepRank(b) || (a.order ?? 100) - (b.order ?? 100),
  );
  const written = new Set<DraftKey>(BASE_DRAFT_KEYS);
  const seen = new Set<string>();

  for (const step of module.steps) {
    ensure(
      module.id,
      step.id.startsWith(`${module.id}.`),
      `шаг «${step.id}» должен начинаться с «${module.id}.»`,
    );
    ensure(module.id, !seen.has(step.id), `шаг «${step.id}» объявлен дважды`);
    seen.add(step.id);
    ensure(
      module.id,
      STAGES.includes(step.stage),
      `шаг «${step.id}»: стадия «${String(step.stage)}» не из STAGES`,
    );
    ensure(module.id, Array.isArray(step.reads) && step.reads.length > 0, `шаг «${step.id}»: массив reads пуст`);
    ensure(module.id, Array.isArray(step.writes), `шаг «${step.id}»: writes должен быть массивом`);
    ensure(
      module.id,
      step.order === undefined || (typeof step.order === 'number' && !Number.isNaN(step.order)),
      `шаг «${step.id}»: order должен быть числом`,
    );
  }

  for (const step of ordered) {
    for (const key of step.reads) {
      ensure(
        module.id,
        written.has(key),
        `шаг «${step.id}» читает «${key}», но раньше его никто не записал (и это не базовый ключ черновика)`,
      );
    }
    step.writes.forEach((key) => written.add(key));
  }
}

function assertEvents(module: ServerModule): void {
  for (const event of module.events) {
    ensure(
      module.id,
      event.type.startsWith(`${module.id}.`),
      `событие «${event.type}» должно начинаться с «${module.id}.»`,
    );
    ensure(module.id, Boolean(event.description?.trim()), `событие «${event.type}»: пустое описание`);
  }
}

const VALID_PERMISSIONS = new Set<string>(Object.values(ROLE_PERMISSIONS).flat());

/** Инструменты и агенты: описание, схема, право, ссылки на существующие инструменты. */
function assertToolsAndAgents(module: ServerModule): void {
  const names = new Set<string>();
  for (const tool of module.tools) {
    ensure(module.id, tool.name.trim() !== '', 'инструмент без имени');
    ensure(module.id, !names.has(tool.name), `инструмент «${tool.name}» объявлен дважды`);
    names.add(tool.name);
    ensure(
      module.id,
      Boolean(tool.description?.trim()),
      `инструмент «${tool.name}»: пустое описание для модели`,
    );
    ensure(module.id, isZodSchema(tool.input), `инструмент «${tool.name}»: input не является Zod-схемой`);
    ensure(
      module.id,
      VALID_PERMISSIONS.has(tool.capability),
      `инструмент «${tool.name}»: неизвестное право «${String(tool.capability)}»`,
    );
  }

  let registryTools: ReadonlySet<string>;
  try {
    registryTools = new Set(buildRegistries([module]).tools.keys());
  } catch (error) {
    fail(module.id, `реестр инструментов не собрался: ${errorMessage(error)}`);
  }

  const agentIds = new Set<string>();
  for (const agent of module.agents) {
    ensure(module.id, agent.id.trim() !== '', 'агент без id');
    ensure(module.id, !agentIds.has(agent.id), `агент «${agent.id}» объявлен дважды`);
    agentIds.add(agent.id);
    ensure(module.id, agent.promptId.trim() !== '', `агент «${agent.id}»: пустой promptId`);
    ensure(module.id, isZodSchema(agent.submit), `агент «${agent.id}»: submit не является Zod-схемой`);
    for (const name of agent.tools) {
      ensure(
        module.id,
        registryTools.has(name),
        `агент «${agent.id}» ссылается на несуществующий инструмент «${name}»`,
      );
    }
  }
}

function assertRoutes(module: ServerModule): void {
  const deps = fakeDeps(makeReferenceData(), new MemoryStore(), makePorts());

  let mounted: ReturnType<typeof collectRoutes>;
  try {
    mounted = collectRoutes([module], deps);
  } catch (error) {
    fail(module.id, `маршруты не собрались: ${errorMessage(error)}`);
  }

  for (const item of mounted) {
    for (const route of item.routes) {
      ensure(module.id, route.path.startsWith('/'), `маршрут «${route.path}» должен начинаться с «/»`);
      ensure(
        module.id,
        route.access !== 'any',
        `маршрут ${route.method} ${route.path} без права доступа (access: 'any')`,
      );
      ensure(
        module.id,
        route.body === undefined || isZodSchema(route.body),
        `маршрут ${route.method} ${route.path}: body не является Zod-схемой`,
      );
      ensure(
        module.id,
        route.response === undefined || isZodSchema(route.response),
        `маршрут ${route.method} ${route.path}: response не является Zod-схемой`,
      );
    }
  }
}

function assertReadme(module: ServerModule, readmePath?: string): void {
  const path = readmePath
    ? resolve(readmePath)
    : resolve(process.cwd(), 'modules', module.id, 'README.md');
  ensure(module.id, existsSync(path), `нет README по пути ${path}`);
}

function assertPrompts(module: ServerModule, promptRoot?: string): void {
  for (const [aspectKey, schema] of Object.entries(module.aspects)) {
    const promptFile = (schema as unknown as { promptFile?: unknown }).promptFile;
    if (promptFile === undefined) continue;
    ensure(
      module.id,
      typeof promptFile === 'string' && promptFile.trim() !== '',
      `аспект «${aspectKey}»: promptFile должен быть непустой строкой`,
    );
    const path = resolve(promptRoot ?? process.cwd(), promptFile);
    ensure(module.id, existsSync(path), `аспект «${aspectKey}»: нет файла промпта ${path}`);
  }
}

async function assertSeed(module: ServerModule): Promise<void> {
  if (!module.seed) return;
  try {
    await module.seed({
      db: new MemoryStore(),
      data: makeReferenceData(),
      clock: { now: () => new Date() },
    });
  } catch (error) {
    fail(module.id, `сид упал: ${errorMessage(error)}`);
  }
}

/** Проверяет один модуль по контракту из раздела 10 спецификации. */
export async function assertModuleContract(
  module: ServerModule,
  opts: ModuleContractOptions = {},
): Promise<void> {
  ensure(
    module.id,
    /^[a-z][a-z0-9-]*$/.test(module.id),
    'id должен соответствовать ^[a-z][a-z0-9-]*$',
  );
  ensure(module.id, module.title.trim() !== '', 'пустой title');

  assertSteps(module);
  assertEvents(module);
  assertToolsAndAgents(module);
  assertRoutes(module);
  assertReadme(module, opts.readmePath);
  assertPrompts(module, opts.promptRoot);
  await assertSeed(module);
}

async function runOnce(
  modules: readonly ServerModule[],
  appeal: Appeal,
  data: ReferenceData,
  ports: Ports,
  store: KernelStore,
  excludeStepIds: ReadonlySet<string>,
): Promise<AnalysisDraft> {
  const bus = new KernelEventBus(store);
  const registries = buildRegistries(modules, data.fields);
  const steps = [...coreSteps(), ...registries.steps.filter((step) => !excludeStepIds.has(step.id))];
  const engine = new PipelineEngine({ bus, ports, data, steps, store, mode: 'stub' });
  const result = await engine.run(appeal);
  return result.draft;
}

/**
 * Прогоняет пайплайн в режиме `stub` на полном наборе модулей и по очереди
 * с каждым выключенным модулем. Возвращает черновик полного прогона.
 */
export async function runModuleContract(
  opts: RunModuleContractOptions,
): Promise<{ draft: AnalysisDraft }> {
  const appeal = opts.appeal ?? makeAppeal();
  const data = opts.referenceData ?? makeReferenceData();
  const ports = opts.ports ?? makePorts();
  const store = new MemoryStore();
  const noExclusions: ReadonlySet<string> = new Set();

  const draft = await runOnce(opts.modules, appeal, data, ports, store, noExclusions);

  for (const module of opts.modules) {
    const rest = opts.modules.filter((item) => item.id !== module.id);
    const moduleSteps: ReadonlySet<string> = new Set(module.steps.map((step) => step.id));
    await runOnce(rest, appeal, data, ports, store, moduleSteps);
  }

  return { draft };
}
