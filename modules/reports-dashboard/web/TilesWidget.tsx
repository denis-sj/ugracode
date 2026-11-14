import type { JSX } from 'react';
import type { OverviewResult } from '../contracts';
import type { OverviewFiltersState } from './api';
import {
  countDelta,
  formatCount,
  formatMinutes,
  formatPercent,
  minutesDelta,
  percentDelta,
  pointsDelta,
} from './format';
import type { DeltaView } from './format';
import { useOverview } from './useOverview';

export interface TilesWidgetProps {
  days?: number;
  filters?: OverviewFiltersState;
  overview?: OverviewResult;
  /** `false` — данные уже загружены страницей и переданы через `overview`. */
  fetchOwn?: boolean;
}

/** Очередь пока не читает фильтры из адреса — ведём на общий список. ❓ */
export const TILE_QUEUE_HREF = '#/queue';

const TONE_CLASS: Record<DeltaView['tone'], string> = {
  ok: 'rd-delta--ok',
  warn: 'rd-delta--warn',
  danger: 'rd-delta--danger',
  muted: 'rd-delta--muted',
};

interface Tile {
  label: string;
  value: string;
  delta: DeltaView;
  hint: string;
}

export function tilesOf(data: OverviewResult): Tile[] {
  return [
    {
      label: 'Обращений',
      value: formatCount(data.totals.total),
      delta: percentDelta(data.deltas.total),
      hint: `в прошлом периоде: ${formatCount(data.previousTotals.total)}`,
    },
    {
      label: 'Открытых',
      value: formatCount(data.totals.open),
      delta: countDelta(data.deltas.open),
      hint: `в прошлом периоде: ${formatCount(data.previousTotals.open)}`,
    },
    {
      label: 'Аварий',
      value: formatCount(data.totals.emergency),
      delta: countDelta(data.deltas.emergency),
      hint: `в прошлом периоде: ${formatCount(data.previousTotals.emergency)}`,
    },
    {
      label: 'В срок',
      value: formatPercent(data.totals.slaOnTimePercent),
      delta: pointsDelta(data.deltas.slaOnTime),
      hint: `нарушений SLA: ${formatCount(data.totals.slaBreaches)}`,
    },
    {
      label: 'Решение, среднее',
      value: formatMinutes(data.avgResolutionMinutes),
      delta: minutesDelta(data.deltas.avgResolutionMinutes),
      hint: 'по закрытым заявкам',
    },
  ];
}

/** Пять плиток руководителя: крупная цифра, ▲/▼ к прошлому периоду, клик — очередь. */
export function TilesWidget({
  days = 30,
  filters = {},
  overview,
  fetchOwn = true,
}: TilesWidgetProps): JSX.Element {
  const fetched = useOverview(fetchOwn ? { days, ...filters } : null);
  const data = overview ?? fetched.data;

  if (!data) {
    return (
      <div className="rd-placeholder" aria-busy={fetched.loading}>
        {fetched.error ?? 'Считаем показатели…'}
      </div>
    );
  }

  return (
    <div className="rd-tiles">
      {tilesOf(data).map((tile) => (
        <a
          className="ugra-card ugra-card--interactive rd-tile ugra-rise"
          key={tile.label}
          href={TILE_QUEUE_HREF}
          title={`${tile.delta.text} · ${tile.hint}. Открыть заявки в очереди`}
        >
          <span className="rd-tile__label">{tile.label}</span>
          <span className="rd-tile__value">{tile.value}</span>
          <span className={`rd-tile__delta ${TONE_CLASS[tile.delta.tone]}`}>{tile.delta.text}</span>
        </a>
      ))}
    </div>
  );
}

/** Компактный заголовок блока: одинаковый у страницы и виджета. */
export function SectionTitle({ children }: { children: string }): JSX.Element {
  return <h2 className="rd-section-title">{children}</h2>;
}
