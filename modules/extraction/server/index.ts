import type { AgentContext, KernelStore, PipelineStep, StepContext, ToolDef } from '@ugra/core';
import { MemoryStore, coreTools, defineModule, runAgent } from '@ugra/core';
import type { Metric, User } from '@ugra/contracts';
import { INTAKE_STEP_ID, fieldsFromIntake, intakeAgent } from './intake';
import { GROUND_STEP_ID, groundDraft } from './ground';
import { evaluateFields } from './evaluate';
import { sourcesText } from './rules';

/** Харнесс и часть окружения могут передать в шаг пользователя и хранилище (в ядре их пока нет). */
interface RuntimeStepContext extends StepContext {
  user?: User;
  db?: KernelStore;
}

function fallbackUser(ctx: StepContext): User {
  return {
    id: ctx.appeal.authorId,
    fullName: 'Заявитель',
    role: 'applicant',
    departmentId: null,
    position: 'Заявитель',
  };
}

function agentContextOf(ctx: StepContext, text: string): AgentContext & { sourceText: string } {
  const runtime = ctx as RuntimeStepContext;
  return {
    user: runtime.user ?? fallbackUser(ctx),
    appeal: ctx.appeal,
    ports: ctx.ports,
    data: ctx.data,
    db: runtime.db ?? new MemoryStore(),
    clock: ctx.ports.clock,
    sourceText: text,
  };
}

/** Только инструменты ядра: агент ничего не пишет и не дублирует ядро. */
function intakeTools(): Map<string, ToolDef> {
  const allowed = new Set(intakeAgent.tools);
  return new Map(
    coreTools()
      .filter((tool) => allowed.has(tool.name))
      .map((tool) => [tool.name, tool]),
  );
}

function reportStep(ctx: StepContext, tool: string, summary: string): void {
  ctx.progress({
    stepId: INTAKE_STEP_ID,
    status: 'progress',
    message: tool === 'submit' ? `Результат сдан: ${summary}` : `${tool}: ${summary}`,
  });
}

function reportFields(ctx: StepContext, fields: ReturnType<typeof fieldsFromIntake>): void {
  for (const field of Object.values(fields)) {
    const label = ctx.data.fields.find((def) => def.key === field.key)?.label ?? field.key;
    const value = field.value === null ? 'отброшено проверкой' : String(field.value);
    ctx.progress({
      stepId: INTAKE_STEP_ID,
      status: 'progress',
      fields: [field.key],
      message: `${label}: ${value}`,
    });
  }
}

/** Шаг `agent.intake`: цикл агента с инструментами; итог — только `submit`, проверенный схемой и кодом. */
const intakeStep: PipelineStep = {
  id: INTAKE_STEP_ID,
  title: 'Разбираем обращение агентом',
  stage: 'extract',
  order: 100,
  // Живой агент делает несколько вызовов модели и инструментов; 15 с движка мало.
  timeoutMs: 45000,
  reads: ['sources'],
  writes: ['fields', 'ext'],
  async run(ctx) {
    const text = sourcesText(ctx.draft.sources);
    if (text.trim() === '') throw new Error('в обращении нет текста для разбора');
    const runtime = ctx as RuntimeStepContext;

    const run = await runAgent(
      intakeAgent,
      { text, context: agentContextOf(ctx, text) },
      {
        llm: ctx.ports.llm,
        tools: ctx.tools ?? intakeTools(),
        runId: ctx.runId,
        store: runtime.db,
        onStep: (step) => reportStep(ctx, step.tool, step.resultSummary),
      },
    );
    if (run.status !== 'ok' || !run.result) {
      throw new Error(`агент intake не выполнил разбор: ${run.error ?? 'нет результата'}`);
    }

    const at = ctx.ports.clock.now().toISOString();
    const fields = fieldsFromIntake(run.result, ctx.draft.sources, ctx.data, at, ctx.appeal.id);
    reportFields(ctx, fields);
    return {
      fields,
      knowledge: (run.result.articles ?? []).map((article, index) => ({
        kind: 'article' as const,
        id: article.id,
        title: article.title ?? article.id,
        score: 1 - index * 0.1,
      })),
      ext: {
        ...ctx.draft.ext,
        extraction: {
          summary: run.result.summary,
          clarify: run.result.clarify,
          emergency: run.result.emergency,
        },
      },
    };
  },
  evaluate(expected, draft) {
    return evaluateFields(expected, draft) as Metric[];
  },
};

/** Шаг `extraction.ground`: проверки кодом после модели + сверка с CMDB. */
const groundStep: PipelineStep = {
  id: GROUND_STEP_ID,
  title: 'Проверяем цитаты и технику в CMDB',
  stage: 'validate',
  order: 100,
  reads: ['fields'],
  writes: ['fields', 'ext'],
  async run(ctx) {
    const { fields, extraction } = await groundDraft(ctx);
    return { fields, ext: { ...ctx.draft.ext, extraction } };
  },
};

export default defineModule({
  id: 'extraction',
  title: 'Разбор обращения агентом',
  enabledByDefault: true,
  steps: [intakeStep, groundStep],
  agents: [intakeAgent],
});
