import type { JSX } from 'react';
import { InsightBlock } from '@ugra/ui';
import type { Heatmap, OverviewResult, OverviewSlice } from '../contracts';
import type { OverviewFiltersState } from './api';
import { barPercent, formatCount, formatPercent, heatLevel, heatmapIsEmpty } from './format';
import { SectionTitle } from './TilesWidget';
import { useOverview } from './useOverview';

export interface MainWidgetProps {
  days?: number;
  filters?: OverviewFiltersState;
  overview?: OverviewResult;
  fetchOwn?: boolean;
}

const PRIORITY_CLASS: Record<string, string> = {
  emergency: 'rd-bar__fill--emergency',
  critical: 'rd-bar__fill--critical',
  high: 'rd-bar__fill--high',
  medium: 'rd-bar__fill--medium',
  low: 'rd-bar__fill--low',
};

const PRIORITY_SWATCH: Record<string, string> = {
  emergency: 'rd-swatch--emergency',
  critical: 'rd-swatch--critical',
  high: 'rd-swatch--high',
  medium: 'rd-swatch--medium',
  low: 'rd-swatch--low',
};

function hasPriorityData(slices: readonly OverviewSlice[]): boolean {
  return slices.some((slice) => slice.count > 0);
}

function PriorityChart({ data }: { data: OverviewResult }): JSX.Element {
  const max = Math.max(1, ...data.byPriority.map((slice) => slice.count));
  const empty = !hasPriorityData(data.byPriority);

  return (
    <section className="ugra-card rd-card">
      <div className="rd-card__head">
        <SectionTitle>По приоритетам</SectionTitle>
        <div className="rd-legend" aria-hidden="true">
          {data.byPriority.map((slice) => (
            <span className="rd-legend__item" key={slice.key}>
              <i className={`rd-swatch ${PRIORITY_SWATCH[slice.key] ?? 'rd-swatch--low'}`} />
              {slice.label}
            </span>
          ))}
        </div>
      </div>

      {empty ? (
        <div className="rd-empty" role="status">
          <span className="rd-empty__title">За период обращений нет</span>
          <span className="rd-empty__hint">График заполнится, когда появятся заявки.</span>
        </div>
      ) : (
        <>
          <div className="rd-chart" role="img" aria-label="Обращения по приоритетам">
            {data.byPriority.map((slice) => (
              <div
                className="rd-chart__col"
                key={slice.key}
                title={`${slice.label}: ${formatCount(slice.count)}`}
              >
                <span className="rd-chart__count">{formatCount(slice.count)}</span>
                <span className="rd-chart__track">
                  <span
                    className={`rd-chart__fill ${PRIORITY_CLASS[slice.key] ?? 'rd-bar__fill--low'}`}
                    style={{ height: `${barPercent(slice.count, max)}%` }}
                  />
                </span>
              </div>
            ))}
          </div>
          <div className="rd-chart__axis" aria-hidden="true">
            {data.byPriority.map((slice) => (
              <span key={slice.key}>{slice.label}</span>
            ))}
          </div>
        </>
      )}

      <InsightBlock className="rd-insight">{data.insights.priorities}</InsightBlock>
    </section>
  );
}

function HeatmapGrid({ heatmap }: { heatmap: Heatmap }): JSX.Element {
  return (
    <div className="rd-heat" role="table" aria-label="Тепловая карта: день и час">
      <div className="rd-heat__row rd-heat__row--head" role="row">
        <span />
        {heatmap.hours.map((hour) => (
          <span className="rd-heat__hour" key={hour} role="columnheader">
            {hour}
          </span>
        ))}
      </div>
      {heatmap.days.map((row) => (
        <div className="rd-heat__row" key={row.day} role="row">
          <span className="rd-heat__day" role="rowheader">
            {row.day}
          </span>
          {row.cells.map((cell) => {
            const level = heatLevel(cell.count, heatmap.max);
            return (
              <span
                className={cell.count === 0 ? 'rd-heat__cell rd-heat__cell--zero' : 'rd-heat__cell'}
                key={cell.hour}
                role="cell"
                title={`${row.day} ${cell.hour}:00 — ${formatCount(cell.count)}`}
                aria-label={`${row.day} ${cell.hour}:00 — ${cell.count}`}
                style={
                  cell.count === 0
                    ? undefined
                    : {
                        background: `color-mix(in srgb, var(--color-accent) ${8 + Math.round(level * 72)}%, transparent)`,
                      }
                }
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

function HeatmapCard({ data }: { data: OverviewResult }): JSX.Element {
  const empty = heatmapIsEmpty(data.heatmap);

  return (
    <section className="ugra-card rd-card">
      <div className="rd-card__head">
        <SectionTitle>Когда приходят обращения</SectionTitle>
        <span className="rd-card__note">Пн–Пт, 8–17</span>
      </div>

      {empty ? (
        <div className="rd-empty" role="status">
          <span className="rd-empty__title">Обращений в рабочие часы нет</span>
          <span className="rd-empty__hint">
            Карта заполнится, когда появятся заявки в это окно.
          </span>
        </div>
      ) : (
        <HeatmapGrid heatmap={data.heatmap} />
      )}

      <InsightBlock className="rd-insight">{data.insights.heatmap}</InsightBlock>
    </section>
  );
}

function SpotCount({ count }: { count: number }): JSX.Element {
  const tone = count >= 3 ? 'rd-spot__count--hot' : count === 2 ? 'rd-spot__count--warm' : '';
  return <strong className={`rd-spot__count ${tone}`}>{formatCount(count)}</strong>;
}

function HotSpots({ data }: { data: OverviewResult }): JSX.Element {
  const meaning = data.insights.hotspots.meaning;
  const action = data.insights.hotspots.action;

  return (
    <section className="ugra-card rd-card rd-card--wide">
      <div className="rd-card__head">
        <div>
          <SectionTitle>Отчёт · горячие точки оборудования</SectionTitle>
          <div className="rd-card__subtitle">Что ломается снова и снова</div>
        </div>
        <span className="rd-card__note">О0 · топ-5 за период</span>
      </div>

      <div className="rd-spots">
        <div className="rd-spots__table">
          <div className="rd-spot rd-spot--head" aria-hidden="true">
            <span>Корпус и кабинет</span>
            <span>Заявок</span>
            <span>Доля</span>
          </div>
          {data.hotSpots.length === 0 && (
            <div className="rd-empty rd-empty--inline" role="status">
              <span className="rd-empty__title">Повторных обращений нет</span>
              <span className="rd-empty__hint">За период ни один кабинет не повторился.</span>
            </div>
          )}
          {data.hotSpots.map((spot) => (
            <div className="rd-spot" key={`${spot.building}-${spot.cabinet}`}>
              <span className="rd-spot__place">
                <strong>{spot.label}</strong>
              </span>
              <SpotCount count={spot.count} />
              <span className="rd-spot__share">{formatPercent(spot.sharePercent)}</span>
            </div>
          ))}
        </div>

        <div className="rd-spots__insights">
          <InsightBlock>{meaning}</InsightBlock>
          {action && <InsightBlock kind="action">{action}</InsightBlock>}
          <p className="rd-source-note">
            Цифры посчитал код, вывод собран по фактам шаблоном. ИИ-агент `analyst` подключится
            отдельной задачей.
          </p>
        </div>
      </div>
    </section>
  );
}

/** Основной блок дашборда: сводка, приоритеты, тепловая карта и горячие точки. */
export function MainWidget({
  days = 30,
  filters = {},
  overview,
  fetchOwn = true,
}: MainWidgetProps): JSX.Element {
  const fetched = useOverview(fetchOwn ? { days, ...filters } : null);
  const data = overview ?? fetched.data;

  if (!data) {
    return (
      <div className="ugra-card rd-card">
        <span className="rd-placeholder">{fetched.error ?? 'Считаем разрезы…'}</span>
      </div>
    );
  }

  return (
    <div className="rd-main">
      <p className="rd-summary">
        {data.insights.summary} {data.insights.sla}
      </p>
      <div className="rd-grid">
        <PriorityChart data={data} />
        <HeatmapCard data={data} />
      </div>
      <HotSpots data={data} />
    </div>
  );
}
