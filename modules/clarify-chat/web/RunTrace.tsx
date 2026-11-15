import { useRef } from 'react';
import type { JSX } from 'react';
import { useListMotion } from '@ugra/ui';
import { formatRunDuration, uniqueStepsByLabel, type RunProgressView } from './format';

interface RunTraceProps {
  progress: RunProgressView;
  busy: boolean;
  open: boolean;
  onToggle: () => void;
}

/** Одна строка «как в ChatGPT»: что делает ИИ прямо сейчас (или сколько заняло). */
function titleOf(progress: RunProgressView, busy: boolean): string {
  if (progress.failed) return 'Не удалось разобрать · показать ход';
  if (busy) {
    const live = progress.current?.trim();
    return live && live !== 'Разбираю обращение' ? `Разбираю обращение · ${live}` : 'Разбираю обращение…';
  }
  if (progress.finished) {
    const spent = formatRunDuration(progress.elapsedMs);
    return spent ? `Разобрал за ${spent} · ход работы` : 'Разбор завершён · ход работы';
  }
  return 'Разбираю обращение…';
}

/**
 * Свёрнутый журнал работы ИИ под сообщением заявителя: по умолчанию одна строка,
 * полный список шагов и галочки — только после раскрытия. Без «мыслей» модели.
 */
export function RunTrace({ progress, busy, open, onToggle }: RunTraceProps): JSX.Element {
  const listRef = useRef<HTMLUListElement | null>(null);
  useListMotion(listRef, open);
  const hasTrace = progress.trace.length > 0;
  const statusClass = progress.failed ? 'chat-trace--failed' : busy ? 'chat-trace--busy' : 'chat-trace--done';
  // Одно название — один шаг: дубли подписей убираем.
  const steps = uniqueStepsByLabel(
    hasTrace ? progress.trace.map((step) => ({ ...step, label: step.label })) : progress.steps,
  ) as Array<{ label: string }>;

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
        {!open && steps.length > 0 && <span className="chat-trace__count">{steps.length} шагов</span>}
      </button>

      {open && (
        <div className="chat-trace__panel">
          <p className="chat-trace__heading">Что делает ИИ</p>
          {steps.length === 0 && <p className="chat-trace__empty">Готовлю первый шаг…</p>}
          <ul className="chat-trace__list" ref={listRef} aria-live="polite">
            {hasTrace
              ? uniqueStepsByLabel(progress.trace).map((step) => {
                  const view = step as (typeof progress.trace)[number];
                  return (
                    <li key={view.n} className={`chat-trace__item chat-trace__item--${view.status}`}>
                      <span className="chat-trace__mark" aria-hidden="true">
                        {view.status === 'done' ? '✓' : view.status === 'running' ? '·' : '!'}
                      </span>
                      <span className="chat-trace__label">{view.label}</span>
                      {view.summary && <span className="chat-trace__summary">{view.summary}</span>}
                      {view.durationMs > 0 && (
                        <span className="chat-trace__time">{formatRunDuration(view.durationMs)}</span>
                      )}
                    </li>
                  );
                })
              : uniqueStepsByLabel(progress.steps).map((step) => {
                  const view = step as (typeof progress.steps)[number];
                  return (
                    <li key={view.stepId} className={`chat-trace__item chat-trace__item--${view.status}`}>
                      <span className="chat-trace__mark" aria-hidden="true">
                        {view.status === 'completed' ? '✓' : '·'}
                      </span>
                      <span className="chat-trace__label">{view.label}</span>
                      {view.message && view.message !== view.label && (
                        <span className="chat-trace__summary">{view.message}</span>
                      )}
                    </li>
                  );
                })}
          </ul>
        </div>
      )}
    </div>
  );
}
