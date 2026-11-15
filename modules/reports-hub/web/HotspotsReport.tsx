import type { JSX } from 'react';
import { useEffect, useRef } from 'react';
import { countUp, cx, fillBar, useListMotion } from '@ugra/ui';
import type { HotspotRowView, HotspotsView } from './format';

/**
 * Наглядный вид отчёта О2 «Горячие точки»: три плитки, лидер крупно и рейтинг полосами.
 * Читается за секунду: что ломается, где, как часто и что с этим делать.
 */

function Counter({ value, suffix = '' }: { value: number; suffix?: string }): JSX.Element {
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => countUp(ref.current, value, { format: (next) => `${Math.round(next)}${suffix}` }), [value, suffix]);
  return <span ref={ref}>{`${value}${suffix}`}</span>;
}

/** Для поломок рост — плохо (красным), падение — хорошо (зелёным). */
function trendTone(text: string, up: boolean): 'flat' | 'bad' | 'good' {
  if (text === 'без изменений') return 'flat';
  return up ? 'bad' : 'good';
}

function Trend({ text, up }: { text: string | null; up: boolean }): JSX.Element | null {
  if (text === null) return null;
  const neutral = text === 'без изменений';
  return (
    <span className={cx('hs-trend', `hs-trend--${trendTone(text, up)}`)}>
      {!neutral && text !== 'новая' && (up ? '▲ ' : '▼ ')}
      {text}
    </span>
  );
}

function Bar({ row, index }: { row: HotspotRowView; index: number }): JSX.Element {
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    fillBar(ref.current, 0.15 + index * 0.07);
  }, [row.key, row.width, index]);
  return (
    <span className="hs-bar">
      <span ref={ref} className={cx('hs-bar__fill', `hs-bar__fill--${row.tone}`)} style={{ width: `${row.width}%` }} />
    </span>
  );
}

export interface HotspotsReportProps {
  view: HotspotsView;
  /** Первое действие из вывода ИИ — под карточкой лидера. */
  action: string | null;
}

export function HotspotsReport({ view, action }: HotspotsReportProps): JSX.Element {
  const listRef = useRef<HTMLOListElement | null>(null);
  useListMotion(listRef, view.rows.length > 0);
  const leader = view.rows[0] ?? null;

  return (
    <div className="hs">
      <div className="hs-tiles">
        <div className="hs-tile">
          <span className="hs-tile__label">Заявок за {view.days} дней</span>
          <span className="hs-tile__value">
            <Counter value={view.total} />
          </span>
          <span className="hs-tile__note">
            <Trend text={view.trend} up={view.trendUp} /> к прошлым {view.days} дням ({view.previousTotal})
          </span>
        </div>
        <div className="hs-tile">
          <span className="hs-tile__label">В точках с повторами</span>
          <span className="hs-tile__value">
            <Counter value={view.repeated} />
          </span>
          <span className="hs-meter" aria-label={`${view.repeatedShare}% всех заявок`}>
            <span className="hs-meter__fill" style={{ width: `${view.repeatedShare}%` }} />
          </span>
          <span className="hs-tile__note">{view.repeatedShare}% всех заявок — это повторные поломки</span>
        </div>
        <div className="hs-tile">
          <span className="hs-tile__label">Точек с повторами</span>
          <span className="hs-tile__value">
            <Counter value={view.rows.length} />
          </span>
          <span className="hs-tile__note">места и техника, где ломалось 2 раза и чаще</span>
        </div>
      </div>

      {leader !== null && (
        <section className="hs-leader" aria-label="Главная горячая точка">
          <div className="hs-leader__main">
            <span className="hs-leader__badge">🔥 Главная точка</span>
            <h3 className="hs-leader__title">{leader.title}</h3>
            <p className="hs-leader__place">{leader.place}</p>
            {action && (
              <p className="hs-leader__action">
                <b>Что сделать:</b> {action}
              </p>
            )}
          </div>
          <dl className="hs-leader__stats">
            <div>
              <dt>заявок</dt>
              <dd className="hs-leader__big">
                <Counter value={leader.count} />
              </dd>
            </div>
            <div>
              <dt>доля</dt>
              <dd>{leader.share}</dd>
            </div>
            <div>
              <dt>в среднем чинили</dt>
              <dd>{leader.avg}</dd>
            </div>
            <div>
              <dt>к прошлому периоду</dt>
              <dd>
                <Trend text={leader.trend} up={leader.trendUp} />
              </dd>
            </div>
          </dl>
        </section>
      )}

      {view.rows.length > 0 && (
        <section className="hs-rank" aria-label="Рейтинг горячих точек">
          <header className="hs-rank__head">
            <h3>Рейтинг повторных поломок</h3>
            <span className="hs-legend">
              <i className="hs-legend__dot hs-legend__dot--hot" /> часто
              <i className="hs-legend__dot hs-legend__dot--warm" /> заметно
              <i className="hs-legend__dot hs-legend__dot--calm" /> изредка
            </span>
          </header>
          <ol className="hs-rank__list" ref={listRef}>
            {view.rows.map((row, index) => (
              <li className="hs-row" key={row.key}>
                <span className={cx('hs-row__rank', `hs-row__rank--${row.tone}`)}>{row.rank}</span>
                <span className="hs-row__what">
                  <strong>{row.title}</strong>
                  <span>
                    {row.kind === 'equipment' ? 'техника' : 'кабинет'} · {row.place}
                  </span>
                </span>
                <Bar row={row} index={index} />
                <span className="hs-row__count">{row.count}</span>
                <span className="hs-row__avg" title="Среднее время решения">
                  {row.avg}
                </span>
                <span className="hs-row__trend">
                  <Trend text={row.trend} up={row.trendUp} />
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
