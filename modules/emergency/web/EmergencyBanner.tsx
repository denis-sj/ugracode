import './emergency.css';
import type { EmergencyVerdict, TicketAnalysisResponse, TicketResponse } from '@ugra/contracts';
import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import type { ApiClient } from '@ugra/ui';
import { emergencyBanner, type EmergencyBanner as EmergencyBannerData } from './banner';
import { readEmergencyVerdict, signLabel } from './format';

/**
 * Виджет `ticket.banner`: красный режим карточки заявки (дизайн 4.5).
 *
 * Карточка заявки в `apps/web` пока не передаёт анализ в слот, поэтому виджет умеет два режима:
 * 1) готовый вердикт пришёл пропсами (`emergency`, `isEmergency`, `detectedAt`);
 * 2) есть только `ticketId` и `api` — тогда анализ загружается внутри виджета.
 *
 * Авария — красная точка, красный текст и тонкая линия, без красного фона (раздел 1 дизайна).
 */
export interface EmergencyBannerProps {
  api?: ApiClient;
  ticketId?: string;
  /** Поле заявки `isEmergency`; `undefined` — неизвестно, виджет загрузит сам. */
  isEmergency?: boolean;
  emergency?: EmergencyVerdict | null;
  /** Время события `emergency.detected` для подписи «кого уведомили и когда». */
  detectedAt?: string | null;
}

interface LoadedBanner {
  emergency: EmergencyVerdict | null;
  isEmergency: boolean;
}

function BannerBody({ banner }: { banner: EmergencyBannerData }): JSX.Element {
  return (
    <section
      className="er-banner"
      role="status"
      aria-label={banner.ariaLabel}
      data-tone={banner.tone}
    >
      <div className="er-banner__head">
        <span className="er-beat" aria-hidden="true" />
        <span>{banner.title}</span>
        {banner.at && <span className="er-banner__at">· {banner.at}</span>}
      </div>

      {banner.signs.length > 0 && (
        <div className="er-banner__signs">
          {banner.signs.map((sign, index) => (
            <span className="er-sign" key={`${sign.sign}-${index}`}>
              <b>{signLabel(sign.sign)}</b>
              {sign.quote !== '' && ` «${sign.quote}»`}
            </span>
          ))}
        </div>
      )}

      {banner.checklist.length > 0 && (
        <ol className="er-banner__list">
          {banner.checklist.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      )}

      {banner.signs.length === 0 && banner.checklist.length === 0 && (
        <p className="er-note">
          Признаков в разборе нет — заявка помечена аварийной. Проверьте текст обращения и регламент.
        </p>
      )}
    </section>
  );
}

export function EmergencyBanner({
  api,
  ticketId,
  isEmergency,
  emergency,
  detectedAt,
}: EmergencyBannerProps): JSX.Element | null {
  const canLoad = api !== undefined && ticketId !== undefined && emergency === undefined && isEmergency === undefined;
  const [loaded, setLoaded] = useState<LoadedBanner | null>(null);

  useEffect(() => {
    if (!canLoad || !api || !ticketId) return undefined;
    let alive = true;
    void Promise.all([
      api
        .get<TicketAnalysisResponse>(`/api/tickets/${ticketId}/analysis`)
        .then((response) => readEmergencyVerdict(response.analysis))
        .catch(() => null),
      api
        .get<TicketResponse>(`/api/tickets/${ticketId}`)
        .then((response) => response.ticket.isEmergency)
        .catch(() => false),
    ]).then(([verdict, flag]) => {
      if (!alive) return;
      setLoaded({ emergency: verdict, isEmergency: flag });
    });
    return () => {
      alive = false;
    };
  }, [api, ticketId, canLoad]);

  if (canLoad && loaded === null) return null;

  const source: LoadedBanner | null = canLoad
    ? loaded
    : { emergency: emergency === undefined ? null : emergency, isEmergency: isEmergency === true };

  if (source === null) return null;
  const banner = emergencyBanner({ emergency: source.emergency, isEmergency: source.isEmergency, detectedAt });
  if (!banner) return null;
  return <BannerBody banner={banner} />;
}
