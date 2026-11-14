import { randomUUID } from 'node:crypto';
import type { AnalysisDraft, Appeal, DraftKey, EventBus, PipelineRun, Stage, StepRun } from '@ugra/contracts';
import { STAGES } from '@ugra/contracts';
import type { ReferenceData } from './data';
import type { Ports } from './ports';
import type { KernelStore } from './storage';
import type { DraftPatch, PipelineStep, RunOptions, RunResult, StepProgress, StepResultLike } from './types';
import type { ToolDef } from './agent';

export interface PipelineDeps {
  bus: EventBus;
  ports: Ports;
  data: ReferenceData;
  steps: readonly PipelineStep[];
  store?: KernelStore;
  mode?: string;
  /** Инструменты ядра и модулей: агенты шагов видят их через `StepContext.tools`. */
  tools?: ReadonlyMap<string, ToolDef>;
  onProgress?: (progress: StepProgress & { runId: string; appealId: string }) => void;
}

class StepTimeoutError extends Error {}

interface StepOutcome {
  status: StepResultLike['status'];
  patch?: DraftPatch;
  error?: string;
  durationMs: number;
}

function mergeDraft(draft: AnalysisDraft, patch: DraftPatch | void): AnalysisDraft {
  if (!patch) return draft;
  return {
    ...draft,
    ...patch,
    fields: { ...draft.fields, ...(patch.fields ?? {}) },
    ext: { ...draft.ext, ...(patch.ext ?? {}) },
  };
}

function stageIndex(stage: Stage): number {
  return STAGES.indexOf(stage);
}

/** Пакеты шагов одной стадии: соседние шаги без общих `reads/writes` идут параллельно. */
function planBatches(steps: readonly PipelineStep[]): PipelineStep[][] {
  const batches: PipelineStep[][] = [];
  let current: PipelineStep[] = [];
  let writes = new Set<DraftKey>();
  let reads = new Set<DraftKey>();
  for (const step of steps) {
    const conflict =
      step.reads.some((key) => writes.has(key)) ||
      step.writes.some((key) => writes.has(key) || reads.has(key));
    if (conflict && current.length > 0) {
      batches.push(current);
      current = [];
      writes = new Set();
      reads = new Set();
    }
    current.push(step);
    step.writes.forEach((key) => writes.add(key));
    step.reads.forEach((key) => reads.add(key));
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

function summarizePatch(patch: DraftPatch): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  if (patch.fields) summary.fields = Object.keys(patch.fields);
  if (patch.missing) summary.missing = patch.missing.map((field) => field.key);
  if (patch.priority) summary.priority = patch.priority.value;
  return summary;
}

export class PipelineEngine {
  constructor(private readonly deps: PipelineDeps) {}

  async run(appeal: Appeal, options: RunOptions = {}): Promise<RunResult> {
    const runId = randomUUID();
    const run: PipelineRun = {
      id: runId,
      ticketId: options.ticketId ?? null,
      appealId: appeal.id,
      mode: this.deps.mode ?? 'stub',
      status: 'running',
      startedAt: new Date().toISOString(),
      finishedAt: null,
    };
    await this.deps.store?.savePipelineRun(run);
    await this.publish('analysis.started', options, { runId, appealId: appeal.id });

    let draft: AnalysisDraft = {
      sources: [{ id: appeal.id, kind: 'text', text: appeal.originalText }],
      fields: {},
      missing: [],
      ext: {},
    };
    const author = this.deps.store ? ((await this.deps.store.getUser(appeal.authorId)) ?? undefined) : undefined;
    const steps = this.selectSteps(options.fromStage);
    const results: StepResultLike[] = [];
    let failed = false;

    for (const stage of STAGES) {
      const inStage = steps
        .filter((step) => step.stage === stage)
        .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
      if (inStage.length === 0) continue;
      for (const batch of planBatches(inStage)) {
        const outcomes = await Promise.all(
          batch.map((step) => this.runStep(step, appeal, draft, runId, options, author)),
        );
        batch.forEach((_step, index) => {
          const outcome = outcomes[index];
          if (!outcome) return;
          draft = mergeDraft(draft, outcome.patch);
          results.push({
            stepId: batch[index]?.id ?? '',
            stage: batch[index]?.stage ?? stage,
            status: outcome.status,
            durationMs: outcome.durationMs,
            error: outcome.error,
          });
          if (outcome.status === 'timeout') failed = true;
        });
      }
    }

    await this.deps.store?.savePipelineRun({
      ...run,
      status: failed ? 'failed' : 'ok',
      finishedAt: new Date().toISOString(),
    });
    await this.publish('analysis.completed', options, {
      runId,
      appealId: appeal.id,
      fields: Object.keys(draft.fields),
      status: failed ? 'failed' : 'ok',
      // Черновик целиком — чтобы карточка заявки показала аварию, вопросы и «почему».
      draft,
    });
    this.report(options, { stepId: 'run', status: failed ? 'failed' : 'completed', runId, appealId: appeal.id });
    return { runId, draft, steps: results, status: failed ? 'failed' : 'ok' };
  }

  /** Повторный запуск с середины — когда заявитель ответил на вопрос (раздел 3.2). */
  async rerun(appeal: Appeal, fromStage: Stage, options: RunOptions = {}): Promise<RunResult> {
    return this.run(appeal, { ...options, fromStage });
  }

  private selectSteps(fromStage?: Stage): PipelineStep[] {
    if (!fromStage) return [...this.deps.steps];
    const from = stageIndex(fromStage);
    return this.deps.steps.filter((step) => stageIndex(step.stage) >= from);
  }

  private async runStep(
    step: PipelineStep,
    appeal: Appeal,
    draft: AnalysisDraft,
    runId: string,
    options: RunOptions,
    author?: import('@ugra/contracts').User,
  ): Promise<StepOutcome> {
    const startedAt = Date.now();
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const timeoutMs = step.timeoutMs ?? 15000;
    this.report(options, { stepId: step.id, status: 'started', runId, appealId: appeal.id });

    const ctx = {
      runId,
      appeal,
      user: author,
      db: this.deps.store,
      bus: this.deps.bus,
      tools: this.deps.tools,
      draft: draft as Readonly<AnalysisDraft>,
      ports: this.deps.ports,
      data: this.deps.data,
      progress: (progress: StepProgress) => this.report(options, { ...progress, runId, appealId: appeal.id }),
      trace: () => undefined,
      signal: controller.signal,
    };

    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new StepTimeoutError(`Шаг ${step.id} не ответил за ${timeoutMs} мс`));
        }, timeoutMs);
      });
      const patch = (await Promise.race([step.run(ctx), timeout])) as DraftPatch | undefined;
      return this.finishStep(step, options, runId, appeal.id, {
        status: 'ok',
        patch,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const timedOut = error instanceof StepTimeoutError;
      if (step.fallback) {
        try {
          const patch = (await step.fallback(ctx, error)) as DraftPatch | undefined;
          return this.finishStep(step, options, runId, appeal.id, {
            status: 'fallback',
            patch,
            durationMs: Date.now() - startedAt,
            error: message,
          });
        } catch (fallbackError) {
          const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
          return this.finishStep(step, options, runId, appeal.id, {
            status: timedOut ? 'timeout' : 'failed',
            durationMs: Date.now() - startedAt,
            error: `${message}; fallback: ${fallbackMessage}`,
          });
        }
      }
      return this.finishStep(step, options, runId, appeal.id, {
        status: timedOut ? 'timeout' : 'failed',
        durationMs: Date.now() - startedAt,
        error: message,
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async finishStep(
    step: PipelineStep,
    options: RunOptions,
    runId: string,
    appealId: string,
    outcome: StepOutcome,
  ): Promise<StepOutcome> {
    const record: StepRun = {
      runId,
      stepId: step.id,
      stage: step.stage,
      status: outcome.status,
      durationMs: outcome.durationMs,
      ticketId: options.ticketId ?? null,
      output: outcome.patch ? summarizePatch(outcome.patch) : undefined,
      error: outcome.error,
    };
    await this.deps.store?.savePipelineStep(record);
    this.report(options, {
      stepId: step.id,
      status: outcome.status === 'ok' || outcome.status === 'fallback' ? 'completed' : 'failed',
      runId,
      appealId,
      message: outcome.error,
    });
    await this.publish('analysis.step.completed', options, {
      stepId: step.id,
      status: outcome.status,
      durationMs: outcome.durationMs,
      error: outcome.error,
    });
    return outcome;
  }

  private async publish(type: string, options: RunOptions, payload: Record<string, unknown>): Promise<void> {
    await this.deps.bus.publish({
      type,
      actor: options.actor ?? { kind: 'ai' },
      ticketId: options.ticketId,
      payload,
    });
  }

  private report(
    options: RunOptions,
    progress: StepProgress & { runId: string; appealId: string },
  ): void {
    this.deps.onProgress?.({ ...progress, ticketId: options.ticketId } as StepProgress & {
      runId: string;
      appealId: string;
    });
  }
}
