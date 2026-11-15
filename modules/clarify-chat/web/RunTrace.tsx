import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { useListMotion } from '@ugra/ui';
import { formatRunDuration, uniqueStepsByLabel, type RunProgressView } from './format';

interface RunTraceProps {
  progress: RunProgressView;
  busy: boolean;
  open: boolean;
  onToggle: () => void;
}

/** Пока модель работает, подпись «дышит»: живой ИИ думает, а не висит. */
export const THINKING_WORDS = ['Думаю', 'Размышляю', 'Сверяю с базой', 'Собираю заявку'] as const;
const THINKING_TICK_MS = 2200;

/** «1 шаг», «3 шага», «5 шагов». */
export function stepsLabel(count: number): string {
  const tail = count % 100;
  const last = count % 10;
  if (tail >= 11 && tail <= 14) return `${count} шагов`;
  if (last === 1) return `${count} шаг`;
  if (last >= 2 && last <= 4) return `${count} шага`;
  return `${count} шагов`;
}

/** Что агент делает сейчас — человеческими словами вместо имени инструмента. */
const TOOL_SAY: Readonly<Record<string, string>> = {
  cmdb_find_equipment: 'ищу технику в CMDB',
  cmdb_locations: 'сверяю кабинет',
  kb_search: 'ищу в базе знаний',
  kb_get_article: 'читаю статью',
  tickets_find_similar: 'смотрю похожие заявки',
  submit: 'собираю заявку',
};

/** «cmdb_find_equipment: CMDB: найдено 4…» → «ищу технику в CMDB»; обычная подпись — как есть. */
export function humanizeLive(live: string): string {
  const match = /^([a-z_]+):/.exec(live);
  if (!match?.[1]) return live;
  return TOOL_SAY[match[1]] ?? 'работаю с данными';
}

/** Одна строка «как в ChatGPT»: что делает ИИ прямо сейчас (или сколько заняло). */
export function titleOf(progress: RunProgressView, busy: boolean, thinking: string = THINKING_WORDS[0]): string {
  if (progress.failed) return 'Не удалось разобрать · показать ход';
  if (busy) {
    const live = progress.current?.trim();
    return live && live !== 'Разбираю обращение' ? `${thinking} · ${humanizeLive(live)}` : `${thinking}…`;
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
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!busy) return undefined;
    const timer = window.setInterval(() => setTick((value) => value + 1), THINKING_TICK_MS);
    return () => window.clearInterval(timer);
  }, [busy]);
  const thinking = THINKING_WORDS[tick % THINKING_WORDS.length] ?? THINKING_WORDS[0];
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
        {busy ? (
          <span className="chat-trace__dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        ) : (
          <span className={`chat-trace__chevron ${open ? 'chat-trace__chevron--open' : ''}`} aria-hidden="true">
            ›
          </span>
        )}
        <span className="chat-trace__title" key={busy ? thinking : 'done'}>
          {titleOf(progress, busy, thinking)}
        </span>
        {!open && steps.length > 0 && <span className="chat-trace__count">{stepsLabel(steps.length)}</span>}
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
