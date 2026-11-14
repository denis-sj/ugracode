import type { AnalysisDraft, Appeal, DraftKey, Metric, Stage, TraceEntry, User } from '@ugra/contracts';
import type { EventBus } from '@ugra/contracts';
import type { KernelStore } from './storage';
import type { ToolDef } from './agent';
import type { ReferenceData } from './data';
import type { Ports } from './ports';

export interface StepProgress {
  stepId: string;
  status: 'started' | 'progress' | 'completed' | 'failed';
  message?: string;
  fields?: string[];
}

/** Частичное изменение черновика: шаг возвращает только то, что он поменял. */
export type DraftPatch = Partial<Omit<AnalysisDraft, 'fields' | 'ext'>> & {
  fields?: AnalysisDraft['fields'];
  ext?: AnalysisDraft['ext'];
};

export interface StepContext {
  runId: string;
  appeal: Appeal;
  /** Автор обращения (если хранилище его знает) — для агентов и проверки ролей. */
  user?: User;
  /** Хранилище ядра: шаги могут читать и писать через сервисы, не зная БД. */
  db?: KernelStore;
  /** Шина событий — шаги модулей публикуют свои события. */
  bus?: EventBus;
  /** Общий реестр инструментов (ядро + модули) для агентов. */
  tools?: ReadonlyMap<string, ToolDef>;
  draft: Readonly<AnalysisDraft>;
  ports: Ports;
  data: ReferenceData;
  progress(p: StepProgress): void;
  trace(e: TraceEntry): void;
  signal: AbortSignal;
}

export interface PipelineStep {
  id: string;
  title: string;
  stage: Stage;
  order?: number;
  reads: DraftKey[];
  writes: DraftKey[];
  timeoutMs?: number;
  run(ctx: StepContext): Promise<DraftPatch | void>;
  fallback?(ctx: StepContext, error: unknown): Promise<DraftPatch | void>;
  evaluate?(expected: unknown, draft: AnalysisDraft): Metric[];
}

export interface RunOptions {
  fromStage?: Stage;
  ticketId?: string;
  actor?: { kind: 'user' | 'ai' | 'system'; id?: string };
}

export interface RunResult {
  runId: string;
  draft: AnalysisDraft;
  steps: StepResultLike[];
  status: 'ok' | 'failed';
}

export interface StepResultLike {
  stepId: string;
  stage: Stage;
  status: 'ok' | 'fallback' | 'failed' | 'timeout';
  durationMs: number;
  error?: string;
}
