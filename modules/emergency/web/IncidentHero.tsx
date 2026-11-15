import type { EmergencyVerdict, Ticket, TicketResponse, User } from '@ugra/contracts';
import type { JSX } from 'react';
import {
  Button,
  Card,
  Icon,
  PersonAvatar,
  Timer,
  formatConfidence,
  formatTicketNumber,
  formatTicketStatus,
  ticketStatusTone,
} from '@ugra/ui';
import {
  channelLabel,
  emergencyLevelLabel,
  eventTime,
  placeLabel,
  quoteSegments,
  type Place,
} from './format';
import { incidentTitle, type ReactionState } from './incident-view';

export interface IncidentHeroProps {
  ticket: Ticket;
  detail: TicketResponse | null;
  detailError: string | null;
  verdict: EmergencyVerdict | null;
  analysisLoading: boolean;
  analysisMissing: boolean;
  categoryLabel: string | null;
  place: Place | null;
  /** Исполнитель заявки, если назначен. */
  assignee: User | null;
  /** Кого предлагает маршрутизация. */
  candidateName: string | null;
  assignAllowed: boolean;
  assignHint: string | null;
  assigning: boolean;
  onAssign: () => void;
  normState: ReactionState;
  normText: string;
  slabFilled: number;
}

const EMPTY_PLACE = 'Место не указано';
const SLABS = 4;

/**
 * Карточка выбранной аварии: всё главное сразу и без прокрутки — уровень, номер,
 * статус, человеческий заголовок, место, цитата с признаками и уверенность,
 * таймер с нормой реакции и ответственный.
 */
export function IncidentHero({
  ticket,
  detail,
  detailError,
  verdict,
  analysisLoading,
  analysisMissing,
  categoryLabel,
  place,
  assignee,
  candidateName,
  assignAllowed,
  assignHint,
  assigning,
  onAssign,
  normState,
  normText,
  slabFilled,
}: IncidentHeroProps): JSX.Element {
  const level = verdict?.level ?? (ticket.isEmergency ? 'suspected' : 'none');
  const active = level !== 'none';
  const title = incidentTitle(detail?.fields, categoryLabel, detail?.appeal.originalText ?? null);
  const placeText = placeLabel(place);
  const startedAt = detail?.appeal.createdAt ?? ticket.createdAt;
  const quote = detail?.appeal.originalText ?? '';
  const quoteParts = quoteSegments(
    quote,
    (verdict?.signs ?? []).map((sign) => sign.quote),
  );
  const tone = ticketStatusTone(ticket.status);

  return (
    <Card className="er-hero" padded={false} hero as="article">
      <div className="er-hero__head">
        <p className={active ? 'er-alarm' : 'er-alarm er-alarm--quiet'}>
          <span className={active ? 'er-beat' : 'er-beat er-beat--off'} aria-hidden="true" />
          {emergencyLevelLabel(level)} · {channelLabel(detail?.appeal.channel)} ·{' '}
          {eventTime(startedAt) ?? '—'}
        </p>
        <div className="er-hero__tags">
          <span className="er-hero__num">{formatTicketNumber(ticket.number)}</span>
          <span className={`er-status er-status--${tone}`}>
            <span className="er-status__dot" aria-hidden="true" />
            {formatTicketStatus(ticket.status)}
          </span>
        </div>
      </div>

      <h2 className="er-hero__title" id="er-hero-title">
        {title}
      </h2>
      <p className="er-hero__place">{placeText === '—' ? EMPTY_PLACE : placeText}</p>

      {detail === null && detailError === null && <p className="er-note">Загружаем обращение…</p>}
      {detailError !== null && (
        <p className="er-note" role="alert">
          Не удалось загрузить обращение: {detailError}
        </p>
      )}

      {detail !== null && quote !== '' && (
        <p className="er-quote">
          «
          {quoteParts.map((part, index) =>
            part.strong ? <strong key={index}>{part.text}</strong> : <span key={index}>{part.text}</span>,
          )}
          »
          {verdict !== null && level !== 'none' && (
            <span className="er-quote__confidence">
              {' '}
              — ИИ уверен на <b>{formatConfidence(verdict.confidence)}</b>
            </span>
          )}
        </p>
      )}

      {!analysisLoading && verdict === null && (
        <p className="er-note">
          {analysisMissing
            ? 'Разбор ИИ недоступен: признаки и регламент появятся позже.'
            : 'Разбора ИИ пока нет: признаки и регламент появятся после обработки.'}
        </p>
      )}
      {verdict !== null && verdict.level === 'none' && (
        <p className="er-note">
          Разбор не нашёл признаков аварии, но заявка помечена аварийной — проверьте текст и регламент.
        </p>
      )}

      <div className="er-facts">
        <div className="er-fact">
          <span className="er-fact__label">С момента обращения</span>
          <Timer from={startedAt} className="er-fact__timer" />
          <span className="er-slabs" aria-hidden="true">
            {Array.from({ length: SLABS }, (_, index) => (
              <i key={index} className={index < slabFilled ? 'on' : undefined} />
            ))}
          </span>
          <span className={`er-fact__norm er-fact__norm--${normState}`}>{normText}</span>
        </div>

        <div className="er-fact er-fact--owner">
          <span className="er-fact__label">Ответственный</span>
          <div className="er-owner">
            {assignee === null ? (
              <span className="er-owner__empty" aria-hidden="true">
                <Icon name="executors" size={20} />
              </span>
            ) : (
              <PersonAvatar name={assignee.fullName} size={40} />
            )}
            <div className="er-owner__text">
              <div className="er-owner__name">{assignee?.fullName ?? 'Не назначен'}</div>
              <div className="er-owner__hint">
                {assignee?.position ??
                  (candidateName === null ? 'Исполнитель не предложен' : `Предлагаем: ${candidateName}`)}
              </div>
            </div>
          </div>
        </div>

        {assignee === null && (
          <div className="er-fact er-fact--action">
            <Button
              variant="primary"
              loading={assigning}
              disabled={!assignAllowed || candidateName === null}
              onClick={onAssign}
              title={
                assignHint ??
                (candidateName === null
                  ? 'Сервер не предложил исполнителя'
                  : `Назначить: ${candidateName} (Enter)`)
              }
            >
              Назначить <span className="er-kbd">Enter</span>
            </Button>
            {assignHint !== null && <p className="er-owner__note">{assignHint}</p>}
          </div>
        )}
      </div>
    </Card>
  );
}
