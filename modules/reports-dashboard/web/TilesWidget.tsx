import type { JSX } from 'react';
import type { OverviewResult } from '../contracts';
import type { OverviewFiltersState } from './api';
import { formatCount, formatMinutes, formatPercent, openStatuses } from './format';
import { useOverview } from './useOverview';

export interface TilesWidgetProps {
  days?: number;
  filters?: OverviewFiltersState;
  overview?: OverviewResult;
  /** `false` — данные уже загружены страницей и переданы через `overview`. */
  fetchOwn?: boolean;
  /** Открыть шторку просрочек на этом же экране. */
  onOverdue?: () => void;
}

/**
 * Три плитки под приоритетами (макет D2): «Сейчас в работе», «Закрыто в срок»
 * с целевой отметкой и «ИИ оформил без правок».
 */
export function TilesWidget({
  days = 30,
  filters = {},
  overview,
  fetchOwn = true,
  onOverdue,
}: TilesWidgetProps): JSX.Element {
  const fetched = useOverview(fetchOwn ? { days, ...filters } : null);
  const data = overview ?? fetched.data;

  if (!data) {
    return (
      <div className="rd-placeholder" aria-busy={fetched.loading} data-motion="off">
        {fetched.error ?? 'Считаем показатели…'}
      </div>
    );
  }

  const statuses = openStatuses(data);
  const onTime = data.totals.slaOnTimePercent;
  const target = data.slaTargetPercent;
  const ai = data.aiEffect;
  const oneIn = ai.correctedTickets > 0 ? Math.round(ai.totalTickets / ai.correctedTickets) : null;

  return (
    <section className="rd-trio" aria-label="Показатели периода">
      <article className="ugra-card rd-mini" data-reveal>
        <span className="rd-mini__label">Сейчас в работе</span>
        <span className="rd-mini__num">{formatCount(data.totals.open)}</span>
        <span className="rd-pipe" aria-hidden="true">
          {statuses.flatMap((status) =>
            Array.from({ length: status.count }, (_, index) => (
              <i key={`${status.key}-${index}`} data-status={status.key} />
            )),
          )}
          {statuses.length === 0 && <i data-status="empty" />}
        </span>
        <span className="rd-legend">
          {statuses.slice(0, 2).map((status) => (
            <span key={status.key}>
              <i data-status={status.key} aria-hidden="true" />
              {status.label} {formatCount(status.count)}
            </span>
          ))}
        </span>
      </article>

      <article className="ugra-card rd-mini" data-reveal>
        <span className="rd-mini__label">Закрыто в срок</span>
        <span className="rd-mini__num">{formatPercent(onTime)}</span>
        <span className="rd-track rd-track--goal" aria-hidden="true">
          <i style={{ width: `${onTime ?? 0}%` }} />
          {target !== null && (
            <b style={{ left: `${Math.min(100, Math.max(0, target))}%` }} title={`Цель ${target}%`} />
          )}
        </span>
        {target !== null && <span className="rd-mini__hint">цель {target}%</span>}
        {data.totals.slaBreaches > 0 ? (
          <button type="button" className="rd-link" onClick={onOverdue}>
            {formatCount(data.totals.slaBreaches)} нарушений SLA →
          </button>
        ) : (
          <span className="rd-mini__hint">нарушений срока нет</span>
        )}
      </article>

      <article className="ugra-card rd-mini" data-reveal>
        <span className="rd-mini__label">ИИ оформил без правок</span>
        <span className="rd-mini__num">{formatPercent(ai.withoutEditsPercent)}</span>
        <span className="rd-track" aria-hidden="true">
          <i data-tone="ok" style={{ width: `${ai.withoutEditsPercent ?? 0}%` }} />
        </span>
        <span className="rd-mini__hint">
          {oneIn === null
            ? 'правок диспетчера за период не было'
            : `диспетчер правит 1 из ${oneIn}`}
        </span>
        {data.avgResolutionMinutes !== null && (
          <span className="rd-mini__hint">решение в среднем {formatMinutes(data.avgResolutionMinutes)}</span>
        )}
      </article>
    </section>
  );
}
