import { useRef } from 'react';
import type { JSX } from 'react';
import { useListMotion } from '@ugra/ui';
import { formatRunDuration, type RunProgressView } from './format';

interface RunTraceProps {
  progress: RunProgressView;
  busy: boolean;
  open: boolean;
  onToggle: () => void;
}

function titleOf(progress: RunProgressView, busy: boolean): string {
  if (progress.failed) return 'Не удалось разобрать · показать ход';
  if (busy) return progress.current ?? 'Разбираю обращение';
  if (progress.finished) {
    const spent = formatRunDuration(progress.elapsedMs);
    return spent ? `Разобрал за ${spent} · ход работы` : 'Разбор завершён · ход работы';
  }
  return 'Разбираю обращение';
}

/**
 * Раскрывающийся журнал работы ИИ под сообщением заявителя: этапы пайплайна
 * и вызовы инструментов с коротким итогом и временем. Без «мыслей» модели.
 */
export function RunTrace({ progress, busy, open, onToggle }: RunTraceProps): JSX.Element {
  const listRef = useRef<HTMLUListElement | null>(null);
  useListMotion(listRef, open);
  const hasTrace = progress.trace.length > 0;
  const statusClass = progress.failed ? 'chat-trace--failed' : busy ? 'chat-trace--busy' : 'chat-trace--done';

  return (
    <div className={`chat-trace ${statusClass}`} data-motion="off">
      <button
        type="button"
        className="chat-trace__toggle"
        aria-expanded={open}
        aria-controls="chat-trace-list"
        onClick={onToggle}
      >
        <span className={`chat-trace__chevron ${open ? 'chat-trace__chevron--open' : ''}`} aria-hidden="true">
          ›
        </span>
        <span className="chat-trace__title">{titleOf(progress, busy)}</span>
        {busy && <span className="chat-trace__shimmer" aria-hidden="true" />}
      </button>

      {open && (
        <div className="chat-trace__panel">
          <p className="chat-trace__heading">Что делает ИИ</p>
          {!hasTrace && progress.steps.length === 0 && (
            <p className="chat-trace__empty">Готовлю первый шаг…</p>
          )}
          <ul className="chat-trace__list" ref={listRef} aria-live="polite">
            {hasTrace
              ? progress.trace.map((step) => (
                  <li key={step.n} className={`chat-trace__item chat-trace__item--${step.status}`}>
                    <span className="chat-trace__mark" aria-hidden="true">
                      {step.status === 'done' ? '✓' : step.status === 'running' ? '·' : '!'}
                    </span>
                    <span className="chat-trace__label">{step.label}</span>
                    {step.summary && <span className="chat-trace__summary">{step.summary}</span>}
                    {step.durationMs > 0 && (
                      <span className="chat-trace__time">{formatRunDuration(step.durationMs)}</span>
                    )}
                  </li>
                ))
              : progress.steps.map((step) => (
                  <li key={step.stepId} className={`chat-trace__item chat-trace__item--${step.status}`}>
                    <span className="chat-trace__mark" aria-hidden="true">
                      {step.status === 'completed' ? '✓' : '·'}
                    </span>
                    <span className="chat-trace__label">{step.label}</span>
                    {step.message && step.message !== step.label && (
                      <span className="chat-trace__summary">{step.message}</span>
                    )}
                  </li>
                ))}
          </ul>
        </div>
      )}
    </div>
  );
}
