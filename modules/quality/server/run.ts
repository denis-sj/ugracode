import type { ToolDef } from '@ugra/core';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import type { AnalysisDraft, Appeal, Channel, FieldDef, Metric, User } from '@ugra/contracts';
import { Channel as ChannelSchema, DictionariesFile, FieldsFile } from '@ugra/contracts';
import type { LlmPort, Ports, ReferenceData } from '@ugra/core';
import {
  KernelEventBus,
  MemoryStore,
  PipelineEngine,
  buildRegistries,
  coreSteps,
  createReferenceData,
} from '@ugra/core';
import type { AgentStepRecord, PipelineStep } from '@ugra/core';
import { StubLlm, createPorts } from '@ugra/adapters';
import type { ScenarioTurn } from '@ugra/adapters';
import type { CaseEvaluation, CaseExpectation, ObservedRun, QualitySummary } from './metrics';
import { evaluateArticle, evaluateAssignee, evaluateEmergency, evaluateFields, evaluatePriority, evaluateQuestion, evaluateTrajectory, summarize } from './metrics';
import { serverModules } from '../../registry.server';

/**
 * Прогон контрольного набора через тот же движок, что и демо (раздел 5.3 харнесса).
 *
 * Один кейс = `testset/cases/NN-*.json` + ответ заглушки `testset/stubs/NN.json`.
 * Заглушка — записанный ответ модели: первый ход `submit` из `NN.json`, приведённый
 * к схеме агента `intake`. Если в записи есть поля без цитаты, `check()` её отклонит —
 * второй ход повторяет `submit` без них, как исправление модели по ошибке проверки.
 */

const StubFieldSchema = z.object({
  key: z.string().min(1),
  value: z.string().nullable().optional(),
  quote: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

const StubFileSchema = z.object({
  fields: z.array(StubFieldSchema).default([]),
  aspects: z
    .object({
      emergency: z
        .object({
          suspected: z.boolean().default(false),
          signs: z.array(z.object({ sign: z.string(), quote: z.string() })).default([]),
          confidence: z.number().min(0).max(1).default(0),
        })
        .optional(),
      summary: z.object({ text: z.string() }).optional(),
    })
    .optional(),
});

/** Итог агента `intake` в том виде, в котором его принимает `submit`. */
export interface IntakeSubmit {
  fields: { key: string; value: string | null; quote: string | null; confidence: number }[];
  emergency: { suspected: boolean; signs: { sign: string; quote: string }[]; confidence: number };
  clarify: null;
  summary: string;
}

const CaseTrajectorySchema = z.object({
  mustCall: z.array(z.string()).optional(),
  mustNotCall: z.array(z.string()).optional(),
  maxSteps: z.number().int().nonnegative().optional(),
});

const ExpectedSchema = z.object({
  fields: z.record(z.string(), z.string().nullable()).optional(),
  priority: z.string().optional(),
  emergency: z.boolean().optional(),
  assigneeTop3: z.array(z.string()).optional(),
  kbArticle: z.string().optional(),
  question: z.string().optional(),
  trajectory: CaseTrajectorySchema.optional(),
});

const CaseSchema = z.object({
  id: z.string().optional(),
  channel: z.string().optional(),
  text: z.string(),
  turns: z.array(z.unknown()).optional(),
  expected: ExpectedSchema.optional(),
});

/** Обращение контрольного набора с эталоном. */
export interface EvalCase {
  /** `id` из файла (`case-01`). */
  id: string;
  /** Имя файла без расширения (`01-printer-hp-312`) — по нему ищем заглушку. */
  file: string;
  channel: Channel;
  text: string;
  expected: CaseExpectation;
  /** Сколько ходов диалога записано в кейсе (информация для отчёта). */
  turns: number;
}

export interface EvalDirs {
  /** `data/*.json`: реестр полей, справочники, матрица, инженеры, CMDB. */
  dataDir: string;
  /** `testset/cases/*.json`. */
  casesDir: string;
  /** `testset/stubs/NN.json`. */
  stubsDir: string;
}

export interface EvalOptions {
  /** Корень репозитория для путей по умолчанию. */
  root?: string;
  dirs?: Partial<EvalDirs>;
  /** Модель для облачного прогона (`--model`). */
  model?: string;
  /** Гнать через Polza, а не через сценарий (`--cloud`). */
  cloud?: boolean;
  /** Один кейс: `04`, `04-network-…` или `case-04` (`--case`). */
  caseId?: string;
  /** Верхняя граница набора: экран «Качество» гоняет не больше 10 обращений. */
  limit?: number;
}

export interface CaseRun {
  evalCase: EvalCase;
  runId: string;
  status: 'ok' | 'failed';
  draft: AnalysisDraft;
  observed: ObservedRun;
  evaluation: CaseEvaluation;
  /** Метрики `evaluate()` шагов модулей — то же, что увидит экран «Качество». */
  stepMetrics: { stepId: string; metrics: Metric[] }[];
  /** Все шаги прогона: шаги пайплайна и вызовы инструментов агента. */
  trace: string[];
  warnings: string[];
}

export interface EvalRun {
  startedAt: string;
  finishedAt: string;
  mode: 'stub' | 'cloud';
  /** Модель прогона: `stub` или id модели. */
  model: string;
  dirs: EvalDirs;
  cases: CaseRun[];
  /** Файлы набора, которые не разобраны (не должны ронять прогон). */
  skipped: { file: string; error: string }[];
  summary: QualitySummary;
  warnings: string[];
}

export function defaultDirs(root = process.cwd()): EvalDirs {
  return {
    dataDir: resolve(root, 'data'),
    casesDir: resolve(root, 'testset/cases'),
    stubsDir: resolve(root, 'testset/stubs'),
  };
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

/** `data/*.json` в `ReferenceData` — те же поля, что грузит API (`apps/api/src/data.ts`). */
export function loadReferenceData(dir: string): ReferenceData {
  const fields = FieldsFile.parse(readJson(join(dir, 'fields.json'))).fields;
  const dictionaries = DictionariesFile.parse(readJson(join(dir, 'dictionaries.json'))).items;
  const settingsFile = z.object({ settings: z.record(z.string(), z.unknown()) }).safeParse(
    readJson(join(dir, 'settings.json')),
  );
  const extra: Record<string, unknown> = {};
  for (const [key, file] of [
    ['cmdb', 'cmdb.json'],
    ['priorityMatrix', 'priority-matrix.json'],
    ['emergencyRules', 'emergency-rules.json'],
    ['engineers', 'engineers.json'],
  ] as const) {
    try {
      extra[key] = readJson(join(dir, file));
    } catch {
      // нет файла — модуль сам скажет, что данных не хватает
    }
  }
  return createReferenceData({
    fields,
    dictionaries,
    settings: settingsFile.success ? settingsFile.data.settings : {},
    extra,
  });
}

function channelOf(raw: string | undefined): Channel {
  const parsed = ChannelSchema.safeParse(raw);
  return parsed.success ? parsed.data : 'chat';
}

/** Все кейсы набора: битые файлы не роняют прогон, а попадают в `skipped`. */
export function loadCases(dir: string): { cases: EvalCase[]; skipped: { file: string; error: string }[] } {
  const skipped: { file: string; error: string }[] = [];
  const cases: EvalCase[] = [];
  let files: string[];
  try {
    files = readdirJson(dir);
  } catch (error) {
    throw new Error(`нет папки набора ${dir}: ${messageOf(error)}`, { cause: error });
  }
  for (const file of files) {
    const name = file.replace(/\.json$/, '');
    let raw: unknown;
    try {
      raw = readJson(join(dir, file));
    } catch (error) {
      skipped.push({ file, error: `файл не разобран: ${messageOf(error)}` });
      continue;
    }
    const parsed = CaseSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      skipped.push({
        file,
        error: `эталон не прошёл схему: ${issue ? `${issue.path.join('.')}: ${issue.message}` : 'неизвестно'}`,
      });
      continue;
    }
    cases.push({
      id: parsed.data.id?.trim() || `case-${name}`,
      file: name,
      channel: channelOf(parsed.data.channel),
      text: parsed.data.text,
      expected: parsed.data.expected ?? {},
      turns: parsed.data.turns?.length ?? 0,
    });
  }
  return { cases, skipped };
}

function readdirJson(dir: string): string[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort((a, b) => a.localeCompare(b));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Номер кейса из имени файла: `01-printer…` → `01`. По нему берём заглушку `stubs/01.json`. */
export function stubNumber(evalCase: EvalCase): string | null {
  const match = /^(\d+)/.exec(evalCase.file);
  return match?.[1] ?? null;
}

/** Записанный ответ заглушки → аргументы `submit` агента `intake`. */
export function submitFromStub(raw: unknown): IntakeSubmit {
  const parsed = StubFileSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`заглушка не разобрана: ${issue ? `${issue.path.join('.')}: ${issue.message}` : 'неизвестно'}`);
  }
  const stub = parsed.data;
  return {
    fields: stub.fields.map((field) => ({
      key: field.key,
      value: field.value ?? null,
      quote: field.quote ?? null,
      confidence: field.confidence ?? 0.5,
    })),
    emergency: {
      suspected: stub.aspects?.emergency?.suspected ?? false,
      signs: stub.aspects?.emergency?.signs ?? [],
      confidence: stub.aspects?.emergency?.confidence ?? 0,
    },
    clarify: null,
    summary: (stub.aspects?.summary?.text ?? '').slice(0, 300),
  };
}

/**
 * Сценарий заглушки: записанный `submit`, а если в записи есть поля без цитаты —
 * второй ход без них (`check()` такие поля отклоняет, модель исправила бы их так же).
 */
export function scenarioFromStub(raw: unknown): ScenarioTurn[] {
  const submit = submitFromStub(raw);
  const turns: ScenarioTurn[] = [{ submit }];
  const quoted = submit.fields.filter((field) => (field.quote ?? '').trim() !== '');
  if (quoted.length !== submit.fields.length) {
    turns.push({ submit: { ...submit, fields: quoted } });
  }
  return turns;
}

function emergencySuspected(draft: AnalysisDraft): boolean {
  if (draft.emergency && draft.emergency.level !== 'none') return true;
  const extraction = draft.ext.extraction as { emergency?: { suspected?: unknown } } | undefined;
  return extraction?.emergency?.suspected === true;
}

/** Статьи, которые выбрал прогон: из черновика и из вызовов `kb_get_article`. */
function chosenArticles(draft: AnalysisDraft, steps: readonly AgentStepRecord[]): string[] {
  const ids: string[] = (draft.knowledge ?? [])
    .filter((hit) => hit.kind === 'article')
    .map((hit) => hit.id);
  for (const step of steps) {
    if (step.tool !== 'kb_get_article') continue;
    const id = (step.args as { id?: unknown } | null)?.id;
    if (typeof id === 'string' && id.trim() !== '') ids.push(id);
  }
  return [...new Set(ids)];
}

function askedFieldOf(draft: AnalysisDraft): string | null {
  const extraction = draft.ext.extraction as { clarify?: { fieldKey?: unknown } | null } | undefined;
  const clarify = extraction?.clarify;
  if (typeof clarify?.fieldKey === 'string' && clarify.fieldKey.trim() !== '') return clarify.fieldKey;
  const aiQuestion = draft.missing.find((item) => item.source === 'ai');
  return aiQuestion?.key ?? null;
}

/** Черновик и след → то, что видят оценщики. */
export function observe(draft: AnalysisDraft, steps: readonly AgentStepRecord[] = []): ObservedRun {
  const fields: ObservedRun['fields'] = {};
  for (const [key, field] of Object.entries(draft.fields)) {
    fields[key] = { value: field.value, quoteText: field.quote?.text ?? null, origin: field.origin };
  }
  return {
    text: draft.sources.map((source) => source.text).join('\n'),
    fields,
    priority: draft.priority?.value ?? null,
    emergency: emergencySuspected(draft),
    assignees: (draft.assignees ?? []).map((candidate) => candidate.userId),
    articles: chosenArticles(draft, steps),
    askedField: askedFieldOf(draft),
    tools: steps.map((step) => step.tool),
    steps: steps.length,
  };
}

export function evaluateCase(
  evalCase: EvalCase,
  observed: ObservedRun,
  fieldDefs: readonly FieldDef[],
  meta: { ms: number; costRub: number; steps: number; errors: string[] },
): CaseEvaluation {
  const expected = evalCase.expected;
  return {
    id: evalCase.id,
    fields: evaluateFields(expected.fields, observed, fieldDefs),
    priority: evaluatePriority(expected.priority, observed),
    emergency: evaluateEmergency(expected.emergency, observed),
    assignee: evaluateAssignee(expected.assigneeTop3, observed),
    article: evaluateArticle(expected.kbArticle, observed),
    question: evaluateQuestion(expected.question, observed),
    trajectory: evaluateTrajectory(expected.trajectory, observed),
    ms: meta.ms,
    costRub: meta.costRub,
    steps: meta.steps,
    errors: meta.errors,
  };
}

/** Выбор одного кейса по `04`, `04-network-…` или `case-04`. */
export function selectCase(cases: readonly EvalCase[], selector: string): EvalCase[] {
  const wanted = selector.trim().toLowerCase();
  if (wanted === '') return [...cases];
  const digits = wanted.replace(/\D/g, '');
  const matches = cases.filter(
    (item) =>
      item.file.toLowerCase().startsWith(wanted) ||
      item.id.toLowerCase() === wanted ||
      (digits !== '' && item.id.toLowerCase() === `case-${digits}`),
  );
  if (matches.length === 0) throw new Error(`кейс «${selector}» не найден в наборе`);
  return matches;
}

interface Usage {
  tokensIn: number;
  tokensOut: number;
  costRub: number;
}

/** Обёртка над LLM: копит токены и рубли прогона — шаг их наружу не отдаёт. */
function meterLlm(llm: LlmPort, usage: Usage): LlmPort {
  return {
    structured: (req) => llm.structured(req),
    async chat(req) {
      const response = await llm.chat(req);
      usage.tokensIn += response.usage?.tokensIn ?? 0;
      usage.tokensOut += response.usage?.tokensOut ?? 0;
      usage.costRub += response.usage?.costRub ?? 0;
      return response;
    },
  };
}

function authorUser(): User {
  return {
    id: 'u-eval-applicant',
    fullName: 'Заявитель (прогон)',
    role: 'applicant',
    departmentId: null,
    position: 'Заявитель',
  };
}

function appealOf(evalCase: EvalCase): Appeal {
  return {
    id: `eval-${evalCase.id}`,
    channel: evalCase.channel,
    authorId: 'u-eval-applicant',
    originalText: evalCase.text,
    attachments: [],
    createdAt: new Date().toISOString(),
  };
}

interface CaseEnvironment {
  data: ReferenceData;
  steps: readonly PipelineStep[];
  tools: ReadonlyMap<string, ToolDef>;
  dirs: EvalDirs;
  mode: 'stub' | 'cloud';
  model?: string | undefined;
  stubRaw: (evalCase: EvalCase) => unknown;
}

function portsFor(env: CaseEnvironment, scenario: ScenarioTurn[], usage: Usage, warnings: string[]): Ports {
  const ports = createPorts({
    ...process.env,
    AI_MODE: env.mode,
    CMDB_PATH: join(env.dirs.dataDir, 'cmdb.json'),
    ...(env.model ? { LLM_MODEL_MAIN: env.model, LLM_MODEL_CHEAP: env.model } : {}),
  });
  if (ports.aiMode !== env.mode) {
    warnings.push(
      env.mode === 'cloud'
        ? 'облако запрошено, но POLZA_API_KEY не задан — прогон через заглушку без сценария'
        : 'AI_MODE=stub не применился',
    );
  }
  const llm = env.mode === 'stub' ? new StubLlm({}, { scenario }) : ports.llm;
  return { ...ports, llm: meterLlm(llm, usage) };
}

async function runCase(env: CaseEnvironment, evalCase: EvalCase): Promise<CaseRun> {
  const warnings: string[] = [];
  const usage: Usage = { tokensIn: 0, tokensOut: 0, costRub: 0 };
  let scenario: ScenarioTurn[] = [];
  if (env.mode === 'stub') {
    try {
      scenario = scenarioFromStub(env.stubRaw(evalCase));
    } catch (error) {
      warnings.push(messageOf(error));
    }
  }

  const store = new MemoryStore();
  seedKnowledgeBase(store, env.dirs.dataDir);
  const bus = new KernelEventBus(store);
  const author = authorUser();
  await store.saveUser(author);
  const appeal = appealOf(evalCase);
  await store.saveAppeal(appeal);

  const engine = new PipelineEngine({
    bus,
    ports: portsFor(env, scenario, usage, warnings),
    data: env.data,
    steps: env.steps,
    store,
    mode: env.mode,
    tools: env.tools,
  });

  const startedAt = Date.now();
  const result = await engine.run(appeal);
  const ms = Date.now() - startedAt;
  const agentSteps = await store.listAgentSteps({ runId: result.runId });

  const errors = result.steps
    .filter((step) => step.status !== 'ok')
    .map((step) => `${step.stepId}: ${step.status}${step.error ? ` — ${step.error}` : ''}`);
  const observed = observe(result.draft, agentSteps);
  const evaluation = evaluateCase(evalCase, observed, env.data.fields, {
    ms,
    costRub: usage.costRub,
    steps: agentSteps.length,
    errors,
  });

  const trace: string[] = [
    `шаги пайплайна (${result.status}):`,
    ...result.steps.map(
      (step) => `  ${step.stepId} — ${step.status}, ${step.durationMs} мс${step.error ? `: ${step.error}` : ''}`,
    ),
    `шаги агента (${agentSteps.length}):`,
    ...agentSteps.map((step) => {
      const flags = [step.blocked ? 'заблокирован' : '', step.error ? `ошибка: ${step.error}` : '']
        .filter(Boolean)
        .join('; ');
      const args = typeof step.args === 'object' ? JSON.stringify(step.args) : String(step.args);
      return `  ${step.n}. ${step.tool} ${args} → ${step.resultSummary}${flags ? ` [${flags}]` : ''}`;
    }),
  ];

  const stepMetrics: { stepId: string; metrics: Metric[] }[] = [];
  for (const step of env.steps) {
    if (!step.evaluate) continue;
    try {
      const metrics = step.evaluate(evalCase.expected, result.draft);
      if (metrics.length > 0) stepMetrics.push({ stepId: step.id, metrics });
    } catch (error) {
      warnings.push(`evaluate() шага ${step.id} упал: ${messageOf(error)}`);
    }
  }

  return {
    evalCase,
    runId: result.runId,
    status: result.status,
    draft: result.draft,
    observed,
    evaluation,
    stepMetrics,
    trace,
    warnings,
  };
}

/** Прогон набора: данные → регистры → по одному обращению через движок → сводка. */
export async function runEval(options: EvalOptions = {}): Promise<EvalRun> {
  const dirs: EvalDirs = { ...defaultDirs(options.root), ...options.dirs };
  const mode: 'stub' | 'cloud' = options.cloud || options.model ? 'cloud' : 'stub';
  const data = loadReferenceData(dirs.dataDir);
  const registries = buildRegistries(serverModules, data.fields);
  const steps = [...coreSteps(), ...registries.steps];
  const loaded = loadCases(dirs.casesDir);
  const selected = options.caseId ? selectCase(loaded.cases, options.caseId) : loaded.cases;
  const limited =
    options.limit !== undefined && options.limit > 0 ? selected.slice(0, options.limit) : selected;
  if (limited.length === 0) throw new Error(`в наборе ${dirs.casesDir} нет ни одного обращения`);

  const warnings: string[] = [];
  const env: CaseEnvironment = {
    data,
    steps,
    tools: registries.tools,
    dirs,
    mode,
    model: options.model,
    stubRaw(evalCase) {
      const number = stubNumber(evalCase);
      if (!number) throw new Error(`не понять номер заглушки по файлу ${evalCase.file}`);
      return readJson(join(dirs.stubsDir, `${number}.json`));
    },
  };

  const startedAt = new Date().toISOString();
  const cases: CaseRun[] = [];
  for (const evalCase of limited) {
    cases.push(await runCase(env, evalCase));
  }
  const finishedAt = new Date().toISOString();

  return {
    startedAt,
    finishedAt,
    mode,
    model: mode === 'cloud' ? (options.model ?? process.env.LLM_MODEL_MAIN ?? 'по умолчанию из окружения') : 'stub',
    dirs,
    cases,
    skipped: loaded.skipped,
    summary: summarize(cases.map((item) => item.evaluation)),
    warnings,
  };
}

/** Полные траектории для `reports/eval-<дата>.json`. */
export function evalReportJson(run: EvalRun): string {
  return JSON.stringify(
    {
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      mode: run.mode,
      model: run.model,
      set: run.dirs.casesDir,
      summary: run.summary,
      skipped: run.skipped,
      warnings: run.warnings,
      cases: run.cases.map((item) => ({
        id: item.evalCase.id,
        file: item.evalCase.file,
        channel: item.evalCase.channel,
        text: item.evalCase.text,
        expected: item.evalCase.expected,
        status: item.status,
        runId: item.runId,
        observed: item.observed,
        evaluation: item.evaluation,
        stepMetrics: item.stepMetrics,
        warnings: item.warnings,
        trace: item.trace,
      })),
    },
    null,
    2,
  );
}

/** Статьи из `data/kb` в память: без PostgreSQL поиск по базе знаний иначе пуст. */
function seedKnowledgeBase(store: MemoryStore, dataDir: string): void {
  const dir = join(dataDir, 'kb');
  let files: string[];
  try {
    files = readdirSync(dir).filter((file) => file.endsWith('.json'));
  } catch {
    return;
  }
  for (const file of files) {
    try {
      const parsed = JSON.parse(readFileSync(join(dir, file), 'utf8')) as {
        articles?: {
          id: string;
          title: string;
          symptoms?: string[];
          steps?: string[];
          solution?: string;
          category?: string;
        }[];
      };
      for (const article of parsed.articles ?? []) {
        void store.saveKnowledgeArticle({
          id: article.id,
          title: article.title,
          symptoms: article.symptoms ?? [],
          steps: article.steps ?? [],
          solution: article.solution ?? '',
          category: article.category ?? '',
        });
      }
    } catch {
      // битый файл данных не должен ронять прогон
    }
  }
}
