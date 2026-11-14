import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { cx } from '../cx';
import { elapsedMs, formatElapsed, type ElapsedStyle } from '../format';

export type ElapsedFrom = string | number | Date | null | undefined;

export interface UseElapsedOptions {
  /** Как часто пересчитывать, мс. По умолчанию раз в секунду. */
  tickMs?: number;
}

/** Живой счётчик времени с момента `from`: обновляется раз в секунду, будущее — ноль. */
export function useElapsed(from: ElapsedFrom, options: UseElapsedOptions = {}): number {
  const { tickMs = 1000 } = options;
  const [elapsed, setElapsed] = useState(() => elapsedMs(from));

  useEffect(() => {
    setElapsed(elapsedMs(from));
    if (from === null || from === undefined || from === '') return undefined;
    const timer = window.setInterval(() => setElapsed(elapsedMs(from)), Math.max(250, tickMs));
    return () => window.clearInterval(timer);
  }, [from, tickMs]);

  return elapsed;
}

export interface TimerProps {
  from: ElapsedFrom;
  style?: ElapsedStyle;
  className?: string;
}

/** Таймер «с момента звонка» / «осталось по регламенту». Само время считает `formatElapsed`. */
export function Timer({ from, style = 'clock', className }: TimerProps): JSX.Element {
  const elapsed = useElapsed(from);
  return (
    <span className={cx('ugra-timer', className)}>
      <time dateTime={typeof from === 'string' ? from : undefined}>{formatElapsed(elapsed, style)}</time>
    </span>
  );
}
