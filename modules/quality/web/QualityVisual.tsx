import type { JSX } from 'react';
import { useEffect, useRef } from 'react';
import { countUp, cx, fillBar } from '@ugra/ui';
import type { CaseRow, MetricView, QualityScore } from './format';

function ringTone(percent: number): 'ok' | 'warn' | 'danger' {
  if (percent >= 90) return 'ok';
  return percent >= 60 ? 'warn' : 'danger';
}

const SCAN_MARK: Readonly<Record<ScanState, string | null>> = { ok: '✓', fail: '✕', scan: '', wait: null };

/** Кольцо общего балла: сколько проверок пройдено из проверяемых. */
export function ScoreRing({ score }: { score: QualityScore }): JSX.Element {
  const radius = 54;
  const length = 2 * Math.PI * radius;
  const ringRef = useRef<SVGCircleElement | null>(null);
  const numberRef = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    const ring = ringRef.current;
    if (ring) {
      ring.style.strokeDashoffset = String(length);
      requestAnimationFrame(() => {
        ring.style.strokeDashoffset = String(length * (1 - score.percent / 100));
      });
    }
    return countUp(numberRef.current, score.met);
  }, [score.met, score.percent, length]);
  const tone = ringTone(score.percent);
  return (
    <div className={cx('qv-ring', `qv-ring--${tone}`)} role="img" aria-label={`Пройдено ${score.met} из ${score.total} проверок`}>
      <svg viewBox="0 0 128 128" aria-hidden="true">
        <circle className="qv-ring__track" cx="64" cy="64" r={radius} />
        <circle
          ref={ringRef}
          className="qv-ring__value"
          cx="64"
          cy="64"
          r={radius}
          strokeDasharray={length}
          strokeDashoffset={length * (1 - score.percent / 100)}
        />
      </svg>
      <span className="qv-ring__text">
        <span className="qv-ring__num">
          <span ref={numberRef}>{score.met}</span>
          <small>/{score.total}</small>
        </span>
        <span className="qv-ring__label">проверок пройдено</span>
      </span>
    </div>
  );
}

const STATE_TEXT: Readonly<Record<MetricView['state'], string>> = {
  met: 'в норме',
  unmet: 'ниже порога',
  none: 'не проверяли',
};

/** Карточка метрики: что значит, значение, полоса с отметкой порога. */
export function MetricCard({ metric, index, large = false }: { metric: MetricView; index: number; large?: boolean }): JSX.Element {
  const fillRef = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    fillBar(fillRef.current, 0.1 + index * 0.06);
  }, [metric.percent, index]);
  return (
    <article className={cx('qv-metric', `qv-metric--${metric.state}`, large && 'qv-metric--large')}>
      <header className="qv-metric__head">
        <span className="qv-metric__title">{metric.title}</span>
        <span className="qv-metric__state">
          <i aria-hidden="true" />
          {STATE_TEXT[metric.state]}
        </span>
      </header>
      <span className="qv-metric__value">{metric.display}</span>
      <span className="qv-metric__explain">{metric.explain}</span>
      {metric.percent !== null && (
        <span className="qv-bar" aria-hidden="true">
          <span ref={fillRef} className="qv-bar__fill" style={{ width: `${metric.percent}%` }} />
          {metric.thresholdAt !== null && <span className="qv-bar__mark" style={{ left: `${metric.thresholdAt}%` }} />}
        </span>
      )}
      <span className="qv-metric__threshold">
        порог {metric.threshold}
        {metric.note ? ` · ${metric.note}` : ''}
      </span>
    </article>
  );
}

export type ScanState = 'wait' | 'scan' | 'ok' | 'fail';

/** Итог обращения для живого прогона: все проверяемые ячейки зелёные — «ok». */
export function caseVerdict(row: CaseRow | undefined): ScanState {
  if (!row) return 'ok';
  return row.cells.some((cell) => cell.state === 'fail') ? 'fail' : 'ok';
}

/** Живой прогон: обращения по очереди «проверяются» и получают ✓/✕ из настоящего ответа сервера. */
export function RunScanner({
  titles,
  states,
  done,
}: {
  titles: readonly { id: string; title: string }[];
  states: readonly ScanState[];
  done: number;
}): JSX.Element {
  const total = titles.length;
  return (
    <section className="qv-scan" role="status" aria-live="polite">
      <header className="qv-scan__head">
        <span className="qv-scan__dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <strong>Прогоняю набор через ИИ</strong>
        <span className="qv-scan__count">
          {done} из {total}
        </span>
      </header>
      <span className="qv-scan__bar">
        <span className="qv-scan__fill" style={{ width: `${total === 0 ? 0 : (done / total) * 100}%` }} />
      </span>
      <ol className="qv-scan__list">
        {titles.map((item, index) => {
          const state = states[index] ?? 'wait';
          return (
            <li key={item.id} className={cx('qv-scan__item', `qv-scan__item--${state}`)}>
              <span className="qv-scan__mark" aria-hidden="true">
                {SCAN_MARK[state] ?? index + 1}
              </span>
              <span className="qv-scan__title">{item.title}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
