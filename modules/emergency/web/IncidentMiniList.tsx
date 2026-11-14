import type { JSX } from 'react';
import { Badge } from '@ugra/ui';
import type { IncidentCard } from './format';
import { plural } from './incident-view';

export interface IncidentMiniListProps {
  incidents: readonly IncidentCard[];
  activeId: string | null;
  loading: boolean;
  error: string | null;
  onSelect: (id: string) => void;
  title?: string;
}

/**
 * Инциденты массовости из API: номер, число заявок, корпус и время открытия.
 * Категория не показывается — вместо кода лучше ничего, чем «Без категории».
 */
export function IncidentMiniList({
  incidents,
  activeId,
  loading,
  error,
  onSelect,
  title = 'Массовые сбои',
}: IncidentMiniListProps): JSX.Element {
  return (
    <div className="er-mass__list">
      <div className="er-mass__list-head">
        <h4 className="er-mass__list-title">{title}</h4>
        <span className="er-mass__list-count">{loading ? '…' : incidents.length}</span>
      </div>

      {error !== null && (
        <p className="er-note" role="alert">
          Список инцидентов недоступен: {error}
        </p>
      )}
      {error === null && !loading && incidents.length === 0 && (
        <p className="er-note">Массовых сбоев нет</p>
      )}

      {incidents.map((item) => {
        const active = item.id === activeId;
        return (
          <button
            type="button"
            key={item.id}
            className={active ? 'er-incident-row er-incident-row--on' : 'er-incident-row'}
            aria-pressed={active}
            onClick={() => onSelect(item.id)}
          >
            <span className="er-incident-row__top">
              <span className="er-incident-row__num">№ {item.number}</span>
              <Badge tone={item.status === 'open' ? 'danger' : 'neutral'} dot={item.status === 'open'}>
                {item.statusLabel}
              </Badge>
            </span>
            <span className="er-incident-row__meta">
              <span>
                {item.size} {plural(item.size, 'заявка', 'заявки', 'заявок')}
              </span>
              <span aria-hidden="true">·</span>
              <span>{item.place}</span>
              <span aria-hidden="true">·</span>
              <span>{item.openedAt}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
