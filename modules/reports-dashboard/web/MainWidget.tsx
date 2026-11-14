import type { CSSProperties, JSX } from 'react';
import type { OverviewResult } from '../contracts';
import type { OverviewFiltersState } from './api';
import { heatLevel } from './format';
import { SectionTitle } from './TilesWidget';
import { useOverview } from './useOverview';

export interface MainWidgetProps {
  days?: number;
  filters?: OverviewFiltersState;
  overview?: OverviewResult;
  fetchOwn?: boolean;
}

const PRIORITY_COLOR: Record<string, string> = {
  emergency: 'var(--color-priority-emergency)',
  critical: 'var(--color-priority-critical)',
  high: 'var(--color-priority-high)',
  medium: 'var(--color-priority-medium)',
  low: 'var(--color-priority-low)',
};

const card: CSSProperties = { padding: 'var(--space-5)' };
const mean: CSSProperties = {
  marginTop: 'var(--space-4)',
  padding: 'var(--space-3) var(--space-4)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--color-bg-soft)',
  fontSize: 14,
  lineHeight: 1.55,
  color: 'var(--color-text)',
};
const label: CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--color-text-muted)',
};
const gridTwo: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr)',
  gap: 'var(--space-4)',
  alignItems: 'start',
};

function PriorityChart({ data }: { data: OverviewResult }): JSX.Element {
  const max = Math.max(1, ...data.byPriority.map((slice) => slice.count));
  return (
    <section className="ugra-card ugra-card--padded" style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <SectionTitle>По приоритетам</SectionTitle>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {data.byPriority.map((slice) => (
            <span
              key={slice.key}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                color: 'var(--color-text-muted)',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 3,
                  display: 'inline-block',
                  background: PRIORITY_COLOR[slice.key] ?? 'var(--color-text-dim)',
                }}
              />
              {slice.label}
            </span>
          ))}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 14,
          height: 200,
          marginTop: 'var(--space-5)',
          paddingBottom: 4,
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        {data.byPriority.map((slice) => (
          <div
            key={slice.key}
            title={`${slice.label}: ${slice.count}`}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}
          >
            <span
              style={{
                display: 'block',
                borderRadius: '4px 4px 1px 1px',
                height: `${Math.round((slice.count / max) * 100)}%`,
                minHeight: slice.count > 0 ? 4 : 0,
                background: PRIORITY_COLOR[slice.key] ?? 'var(--color-text-dim)',
              }}
            />
            <span style={{ textAlign: 'center', fontSize: 12, color: 'var(--color-text-muted)' }}>
              {slice.count}
            </span>
          </div>
        ))}
      </div>

      <div style={mean}>
        <strong>Что это значит.</strong> {data.insights.priorities}
      </div>
    </section>
  );
}

function Heatmap({ data }: { data: OverviewResult }): JSX.Element {
  return (
    <section className="ugra-card ugra-card--padded" style={card}>
      <SectionTitle>Когда приходят обращения</SectionTitle>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `28px repeat(${data.heatmap.hours.length}, minmax(0, 1fr))`,
          gap: 4,
          marginTop: 'var(--space-4)',
          alignItems: 'center',
        }}
      >
        <span />
        {data.heatmap.hours.map((hour) => (
          <span key={hour} style={{ textAlign: 'center', fontSize: 11, color: 'var(--color-text-muted)' }}>
            {hour}
          </span>
        ))}
      </div>
      {data.heatmap.days.map((row) => (
        <div
          key={row.day}
          style={{
            display: 'grid',
            gridTemplateColumns: `28px repeat(${data.heatmap.hours.length}, minmax(0, 1fr))`,
            gap: 4,
            marginTop: 4,
            alignItems: 'center',
          }}
        >
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{row.day}</span>
          {row.cells.map((cell) => {
            const level = heatLevel(cell.count, data.heatmap.max);
            return (
              <span
                key={cell.hour}
                title={`${row.day} ${cell.hour}:00 — ${cell.count}`}
                style={{
                  height: 28,
                  borderRadius: 6,
                  background:
                    cell.count === 0
                      ? 'var(--color-bg-soft)'
                      : `color-mix(in srgb, var(--color-accent) ${8 + Math.round(level * 72)}%, transparent)`,
                }}
              />
            );
          })}
        </div>
      ))}
      <div style={mean}>
        <strong>Что это значит.</strong> {data.insights.heatmap}
      </div>
    </section>
  );
}

function HotSpots({ data }: { data: OverviewResult }): JSX.Element {
  return (
    <section className="ugra-card ugra-card--padded" style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <SectionTitle>Отчёт · горячие точки оборудования</SectionTitle>
          <div style={{ fontSize: 20, fontWeight: 700, marginTop: 6 }}>Что ломается снова и снова</div>
        </div>
      </div>

      <div style={gridTwo}>
        <div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0,1fr) 80px 90px',
              gap: 12,
              padding: '12px 0 8px',
              borderBottom: '1px solid var(--color-border)',
            }}
          >
            <span style={label}>Место</span>
            <span style={label}>Заявок</span>
            <span style={label}>Доля</span>
          </div>
          {data.hotSpots.length === 0 && (
            <p className="ugra-muted" style={{ marginTop: 12 }}>
              Повторных обращений по одному месту за период нет.
            </p>
          )}
          {data.hotSpots.map((spot) => (
            <div
              key={`${spot.building}-${spot.cabinet}`}
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0,1fr) 80px 90px',
                gap: 12,
                alignItems: 'center',
                padding: '12px 0',
                borderBottom: '1px solid var(--color-border)',
                fontSize: 14,
              }}
            >
              <span>
                <strong>{spot.label}</strong>
              </span>
              <strong
                style={{
                  color:
                    spot.count >= 3 ? 'var(--color-danger)' : spot.count === 2 ? 'var(--color-warn)' : 'var(--color-text)',
                }}
              >
                {spot.count}
              </strong>
              <span style={{ color: 'var(--color-text-muted)' }}>{spot.sharePercent}%</span>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ padding: 'var(--space-4)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-soft)' }}>
            <div style={label}>Что это значит</div>
            <div style={{ fontSize: 14, lineHeight: 1.55, marginTop: 6 }}>{data.insights.hotspots.meaning}</div>
          </div>
          {data.insights.hotspots.action && (
            <div
              style={{
                padding: 'var(--space-4)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-accent-soft)',
              }}
            >
              <div style={{ ...label, color: 'var(--color-accent)' }}>Что сделать</div>
              <div style={{ fontSize: 14, lineHeight: 1.55, marginTop: 6 }}>{data.insights.hotspots.action}</div>
            </div>
          )}
          <div style={{ fontSize: 12, color: 'var(--color-text-dim)' }}>
            Цифры посчитал код, вывод собран по фактам шаблоном. ИИ-агент `analyst` подключится отдельной задачей.
          </div>
        </div>
      </div>
    </section>
  );
}

/** Основной блок дашборда: приоритеты, тепловая карта и горячие точки. */
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
      <div className="ugra-card ugra-card--padded" aria-busy={fetched.loading}>
        <span className="ugra-muted">{fetched.error ?? 'Считаем разрезы…'}</span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 14 }}>
        {data.insights.summary} {data.insights.sla}
      </p>
      <div style={gridTwo}>
        <PriorityChart data={data} />
        <Heatmap data={data} />
      </div>
      <HotSpots data={data} />
    </div>
  );
}
