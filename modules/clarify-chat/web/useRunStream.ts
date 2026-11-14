import { useCallback, useEffect, useRef, useState } from 'react';
import type { RunStreamEvent } from '@ugra/contracts';
import { initialRunProgress, reduceRunEvent, type RunProgressView } from './format';

const DEFAULT_STEP_DELAY_MS = 160;
const DEFAULT_GUARD_MS = 12_000;

export interface UseRunStreamOptions {
  /** Вызывается один раз: `failed` — разбор не удался или поток оборвался. */
  onFinished: (failed: boolean) => void;
  /** Пауза между шагами при показе истории разбора одним пакетом. */
  stepDelayMs?: number;
  /** Страховка, если SSE не ответил совсем. */
  guardMs?: number;
}

export interface RunStreamResult {
  progress: RunProgressView;
  running: boolean;
  start: (appealId: string) => void;
  stop: () => void;
}

/**
 * Поток `GET /api/appeals/:id/stream` → шаги разбора.
 *
 * Сервер запускает пайплайн синхронно и отдаёт историю разбора одним пакетом
 * (к моменту ответа `POST /appeals` разбор уже завершён). Поэтому события ставятся
 * в очередь и показываются с паузой: разбор выглядит как живой, но данные настоящие.
 * Когда бэкенд начнёт отдавать ответ до разбора, очередь просто перестанет накапливаться.
 */
export function useRunStream({
  onFinished,
  stepDelayMs = DEFAULT_STEP_DELAY_MS,
  guardMs = DEFAULT_GUARD_MS,
}: UseRunStreamOptions): RunStreamResult {
  const [progress, setProgress] = useState<RunProgressView>(initialRunProgress);
  const [running, setRunning] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);
  const queueRef = useRef<RunStreamEvent[]>([]);
  const drainRef = useRef<number | null>(null);
  const guardRef = useRef<number | null>(null);
  const doneRef = useRef(false);
  const finishedRef = useRef(onFinished);

  useEffect(() => {
    finishedRef.current = onFinished;
  }, [onFinished]);

  const closeSource = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
  }, []);

  const clearTimers = useCallback(() => {
    if (drainRef.current !== null) {
      window.clearTimeout(drainRef.current);
      drainRef.current = null;
    }
    if (guardRef.current !== null) {
      window.clearTimeout(guardRef.current);
      guardRef.current = null;
    }
  }, []);

  const finish = useCallback(
    (failed: boolean) => {
      if (doneRef.current) return;
      doneRef.current = true;
      clearTimers();
      closeSource();
      setRunning(false);
      setProgress((previous) =>
        reduceRunEvent(previous, {
          type: failed ? 'run.failed' : 'run.completed',
          runId: '',
          appealId: '',
        }),
      );
      finishedRef.current(failed);
    },
    [clearTimers, closeSource],
  );

  const drain = useCallback(() => {
    drainRef.current = null;
    if (doneRef.current) return;
    const next = queueRef.current.shift();
    if (!next) return;
    setProgress((previous) => reduceRunEvent(previous, next));
    if (next.type === 'run.completed' || next.type === 'run.failed') {
      finish(next.type === 'run.failed');
      return;
    }
    drainRef.current = window.setTimeout(drain, stepDelayMs);
  }, [finish, stepDelayMs]);

  const schedule = useCallback(() => {
    if (drainRef.current === null && !doneRef.current) {
      drainRef.current = window.setTimeout(drain, stepDelayMs);
    }
  }, [drain, stepDelayMs]);

  const stop = useCallback(() => {
    clearTimers();
    closeSource();
    queueRef.current = [];
    setRunning(false);
  }, [clearTimers, closeSource]);

  const start = useCallback(
    (appealId: string) => {
      stop();
      doneRef.current = false;
      setProgress(initialRunProgress());
      setRunning(true);

      if (typeof EventSource === 'undefined') {
        finish(false);
        return;
      }

      const source = new EventSource(`/api/appeals/${appealId}/stream`);
      sourceRef.current = source;
      source.onmessage = (message: MessageEvent<string>) => {
        let event: RunStreamEvent;
        try {
          event = JSON.parse(message.data) as RunStreamEvent;
        } catch {
          return;
        }
        queueRef.current.push(event);
        if (event.type === 'run.completed' || event.type === 'run.failed') closeSource();
        schedule();
      };
      source.onerror = () => {
        if (source.readyState === EventSource.CLOSED && queueRef.current.length === 0) finish(false);
      };
      guardRef.current = window.setTimeout(() => finish(false), guardMs);
    },
    [closeSource, finish, guardMs, schedule, stop],
  );

  useEffect(() => stop, [stop]);

  return { progress, running, start, stop };
}
