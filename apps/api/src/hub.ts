import type { RunStreamEvent } from '@ugra/contracts';
import type { StepProgress } from '@ugra/core';

type Listener = (event: RunStreamEvent) => void;

/** Буфер хода разбора для SSE: новый клиент сначала получает историю, потом живой поток. */
export class ProgressHub {
  private readonly buffers = new Map<string, RunStreamEvent[]>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly finished = new Set<string>();

  publish(progress: StepProgress & { runId: string; appealId: string }): void {
    const event: RunStreamEvent = {
      type: this.typeOf(progress),
      runId: progress.runId,
      appealId: progress.appealId,
      stepId: progress.stepId,
      message: progress.message,
      fields: progress.fields,
      status: progress.status,
    };
    const buffer = this.buffers.get(progress.appealId) ?? [];
    buffer.push(event);
    this.buffers.set(progress.appealId, buffer.slice(-200));
    if (event.type === 'run.completed' || event.type === 'run.failed') this.finished.add(progress.appealId);
    for (const listener of this.listeners.get(progress.appealId) ?? []) listener(event);
  }

  history(appealId: string): RunStreamEvent[] {
    return this.buffers.get(appealId) ?? [];
  }

  isFinished(appealId: string): boolean {
    return this.finished.has(appealId);
  }

  /** Готовое событие (например, `agent.step`) — в тот же буфер и слушатели. */
  publishRaw(event: RunStreamEvent): void {
    const buffer = this.buffers.get(event.appealId) ?? [];
    buffer.push(event);
    this.buffers.set(event.appealId, buffer.slice(-300));
    if (event.type === 'run.completed' || event.type === 'run.failed') this.finished.add(event.appealId);
    for (const listener of this.listeners.get(event.appealId) ?? []) listener(event);
  }

  subscribe(appealId: string, listener: Listener): () => void {
    const set = this.listeners.get(appealId) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(appealId, set);
    return () => {
      set.delete(listener);
    };
  }

  private typeOf(progress: StepProgress): RunStreamEvent['type'] {
    if (progress.stepId === 'run') return progress.status === 'failed' ? 'run.failed' : 'run.completed';
    if (progress.status === 'started') return 'step.started';
    if (progress.status === 'progress') return 'step.progress';
    return 'step.completed';
  }
}
