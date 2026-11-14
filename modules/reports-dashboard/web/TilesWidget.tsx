import type { CSSProperties, JSX } from 'react';
import { StatTile } from '@ugra/ui';
import type { OverviewResult } from '../contracts';
import type { OverviewFiltersState } from './api';
import {
  countDelta,
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

const TONE: Record<DeltaView['tone'], 'default' | 'ok' | 'warn' | 'danger'> = {
  ok: 'ok',
  warn: 'warn',
  danger: 'danger',
  muted: 'default',
};

interface Tile {
  label: string;
  value: string | number;
  delta: DeltaView;
  hint: string;
}

function tilesOf(data: OverviewResult): Tile[] {
  return [
    {
      label: 'Обращений',
      value: data.totals.total,
      delta: percentDelta(data.deltas.total),
      hint: `в прошлом периоде: ${data.previousTotals.total}`,
    },
    {
      label: 'Открытых',
      value: data.totals.open,
      delta: countDelta(data.deltas.open),
      hint: 'ещё в работе',
    },
    {
      label: 'Аварий',
      value: data.totals.emergency,
      delta: countDelta(data.deltas.emergency),
      hint: 'высший приоритет',
    },
    {
      label: 'В срок',
      value: formatPercent(data.totals.slaOnTimePercent),
      delta: pointsDelta(data.deltas.slaOnTime),
      hint: `нарушений SLA: ${data.totals.slaBreaches}`,
    },
    {
      label: 'Решение, среднее',
      value: formatMinutes(data.avgResolutionMinutes),
      delta: minutesDelta(data.deltas.avgResolutionMinutes),
      hint: 'по закрытым заявкам',
    },
  ];
}

const cardStyle: CSSProperties = {
  display: 'block',
  textDecoration: 'none',
  color: 'var(--color-text)',
};

/** Пять плиток руководителя: значения и сравнение с прошлым периодом. */
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
      <div className="row" aria-busy={fetched.loading}>
        <span className="ugra-muted">{fetched.error ?? 'Считаем показатели…'}</span>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 'var(--space-3)',
      }}
    >
      {tilesOf(data).map((tile) => (
        <a className="ugra-card ugra-card--padded" key={tile.label} href="#/queue" style={cardStyle}>
          <StatTile
            label={tile.label}
            value={tile.value}
            hint={`${tile.delta.text} · ${tile.hint}`}
            tone={TONE[tile.delta.tone]}
          />
        </a>
      ))}
    </div>
  );
}

/** Компактный заголовок блока: одинаковый у страницы и виджета. */
export function SectionTitle({ children }: { children: string }): JSX.Element {
  return (
    <h2
      style={{
        margin: 0,
        fontSize: 13,
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: 'var(--color-text-dim)',
      }}
    >
      {children}
    </h2>
  );
}
