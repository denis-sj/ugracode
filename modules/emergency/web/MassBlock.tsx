import type { JSX, RefObject } from 'react';
import { Badge, Button } from '@ugra/ui';
import {
  MASS_THRESHOLD,
  MASS_WINDOW_MINUTES,
  type IncidentCard,
  type IncidentDetailView,
  type MassDeclareRights,
  type MassTimeline,
} from './format';
import { IncidentMiniList } from './IncidentMiniList';
import { plural } from './incident-view';

export interface MassBlockProps {
  mass: MassTimeline;
  massTotal: number;
  massWindow: number;
  hasPlace: boolean;
  incidentDetail: IncidentDetailView | null;
  incidentError: string | null;
  incidentRef: RefObject<HTMLDivElement | null>;
  incidents: readonly IncidentCard[];
  incidentsLoading: boolean;
  incidentsError: string | null;
  activeIncidentId: string | null;
  onSelectIncident: (id: string) => void;
  rights: MassDeclareRights;
  declaring: boolean;
  onDeclare: () => void;
}

/**
 * Содержимое свёрнутого блока «Массовый сбой?»: сколько похожих за окно,
 * столбики с порогом, карточка инцидента и (для админа) демо-всплеск.
 */
export function MassBlock({
  mass,
  massTotal,
  massWindow,
  hasPlace,
  incidentDetail,
  incidentError,
  incidentRef,
  incidents,
  incidentsLoading,
  incidentsError,
  activeIncidentId,
  onSelectIncident,
  rights,
  declaring,
  onDeclare,
}: MassBlockProps): JSX.Element {
  const sizeLabel = plural(massTotal, 'похожее', 'похожих', 'похожих');
  const thresholdHeight = Math.min(94, Math.round((mass.threshold / mass.max) * 100));
  const otherIncidents =
    incidentDetail === null
      ? incidents
      : incidents.filter((item) => item.id !== incidentDetail.incident.id);
  const showIncidentList =
    incidentDetail === null || otherIncidents.length > 0 || incidentsLoading || incidentsError !== null;

  return (
    <div className="er-mass">
      {hasPlace ? (
        <>
          <div className="er-mass__count">
            <span className="er-mass__num">{massTotal}</span>
            <span className="er-mass__caption">
              {incidentDetail === null
                ? `${sizeLabel} за ${MASS_WINDOW_MINUTES} мин, включая эту заявку`
                : `${sizeLabel} за ${massWindow} мин · в инциденте ${incidentDetail.incident.size}`}
            </span>
          </div>

          <div
            className="er-bars"
            role="img"
            aria-label={`Похожие обращения по минутам: ${massTotal} за ${massWindow} минут, порог ${MASS_THRESHOLD}`}
          >
            <span className="er-bars__threshold" style={{ bottom: `${thresholdHeight}%` }} aria-hidden="true">
              <span>порог</span>
            </span>
            {mass.points.map((point) => {
              const tone = point.count === 0 ? 'empty' : mass.thresholdMet ? 'hot' : 'on';
              const height = Math.max(2, Math.round((point.count / mass.max) * 100));
              return (
                <span
                  key={point.key}
                  className={`er-bar er-bar--${tone}`}
                  style={{ height: `${height}%` }}
                  title={`${point.label} — ${point.count}`}
                />
              );
            })}
          </div>
          <div className="er-bars__axis" aria-hidden="true">
            <span>{mass.points[0]?.label ?? '—'}</span>
            <span>сейчас</span>
          </div>
          <p className="er-note">
            Порог — {MASS_THRESHOLD} похожих за {MASS_WINDOW_MINUTES} минут в одном корпусе (настройка
            массовости).
          </p>
        </>
      ) : (
        <p className="er-note">Недостаточно данных: у заявки не указан корпус — сравнивать не с чем.</p>
      )}

      {incidentError !== null && (
        <p className="er-note" role="alert">
          Не удалось открыть инцидент: {incidentError}
        </p>
      )}

      {incidentDetail !== null && (
        <div className="er-incident" ref={incidentRef}>
          <div className="er-incident__head">
            <span className="er-incident__title">Инцидент № {incidentDetail.incident.number}</span>
            <Badge
              tone={incidentDetail.incident.status === 'open' ? 'danger' : 'neutral'}
              dot={incidentDetail.incident.status === 'open'}
            >
              {incidentDetail.incident.statusLabel}
            </Badge>
          </div>
          <p className="er-incident__text">
            {Math.max(incidentDetail.incident.size, incidentDetail.tickets.length)} заявок ·{' '}
            {incidentDetail.incident.place} · открыт в {incidentDetail.incident.openedAt}
          </p>
          {incidentDetail.tickets.length > 0 && (
            <p className="er-incident__tickets">
              {incidentDetail.tickets.map((ticket) => `№ ${ticket.number}`).join(', ')}
            </p>
          )}
        </div>
      )}

      {showIncidentList && (
        <IncidentMiniList
          incidents={otherIncidents}
          activeId={activeIncidentId}
          loading={incidentsLoading}
          error={incidentsError}
          onSelect={onSelectIncident}
          title={incidentDetail === null ? 'Массовые сбои' : 'Другие инциденты'}
        />
      )}

      {rights.allowed && (
        <Button variant="primary" block loading={declaring} disabled={declaring} onClick={onDeclare}>
          Объявить массовым инцидентом
        </Button>
      )}
    </div>
  );
}
