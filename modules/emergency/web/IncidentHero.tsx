import type { EmergencyVerdict, Ticket, TicketResponse } from '@ugra/contracts';
import type { JSX } from 'react';
import { Card, Checklist, ProgressScale, formatConfidence } from '@ugra/ui';
import {
  channelLabel,
  emergencyLevelLabel,
  eventTime,
  placeLabel,
  quoteSegments,
  type Place,
} from './format';
import { clockFromMs, incidentTitle } from './incident-view';

export interface IncidentHeroProps {
  ticket: Ticket;
  detail: TicketResponse | null;
  detailError: string | null;
  verdict: EmergencyVerdict | null;
  analysisLoading: boolean;
  analysisMissing: boolean;
  categoryLabel: string | null;
  place: Place | null;
  checklist: readonly string[];
  /** Время отметки шага (мс) или `null`, если шаг не отмечен. */
  checks: readonly (number | null)[];
  onToggle: (index: number) => void;
}

const EMPTY_PLACE = 'Место не указано';

/**
 * Левая карточка варианта B: человеческий заголовок, место, цитата с признаками,
 * уверенность одним числом и чек-лист «Что делать сейчас» из регламента.
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
  checklist,
  checks,
  onToggle,
}: IncidentHeroProps): JSX.Element {
  const level = verdict?.level ?? (ticket.isEmergency ? 'suspected' : 'none');
  const active = level !== 'none';
  const title = incidentTitle(detail?.fields, categoryLabel);
  const placeText = placeLabel(place);
  const startedAt = detail?.appeal.createdAt ?? ticket.createdAt;
  const quote = detail?.appeal.originalText ?? '';
  const quoteParts = quoteSegments(
    quote,
    (verdict?.signs ?? []).map((sign) => sign.quote),
  );
  const doneCount = checks.filter((value) => value !== null && value !== undefined).length;
  const items = checklist.map((step, index) => {
    const markedAt = checks[index] ?? null;
    return {
      id: String(index),
      label: step,
      hint: clockFromMs(markedAt),
      done: markedAt !== null,
    };
  });

  return (
    <Card className="er-hero" padded={false} hero as="article">
      <p className={active ? 'er-alarm' : 'er-alarm er-alarm--quiet'}>
        <span className={active ? 'er-beat' : 'er-beat er-beat--off'} aria-hidden="true" />
        {emergencyLevelLabel(level)} · {channelLabel(detail?.appeal.channel)} ·{' '}
        {eventTime(startedAt) ?? '—'}
      </p>

      <h2 className="er-hero__title" id="er-hero-title">
        {title}
        <span className="er-hero__place">{placeText === '—' ? EMPTY_PLACE : placeText}</span>
      </h2>

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
            ? 'Разбор ИИ недоступен: признаки и чек-лист появятся позже.'
            : 'Разбора ИИ пока нет: признаки и чек-лист появятся после обработки.'}
        </p>
      )}
      {verdict !== null && verdict.level === 'none' && (
        <p className="er-note">
          Разбор не нашёл признаков аварии, но заявка помечена аварийной — проверьте текст и регламент.
        </p>
      )}

      <div className="er-steps">
        <div className="er-steps__head">
          <h3 className="er-steps__title">Что делать сейчас</h3>
          <span className="er-steps__count">
            {doneCount} из {checklist.length}
          </span>
        </div>

        {checklist.length > 0 && (
          <>
            <ProgressScale
              stage={doneCount}
              labels={checklist.map((_, index) => String(index + 1))}
              className="er-steps__scale"
            />
            <Checklist items={items} onToggle={(id) => onToggle(Number(id))} label="Шаги регламента" />
          </>
        )}

        {analysisLoading && <p className="er-note">Загружаем регламент…</p>}
        {!analysisLoading && checklist.length === 0 && (
          <p className="er-note">Регламент не задан: в разборе нет чек-листа. Действуйте по инструкции дежурного.</p>
        )}
      </div>
    </Card>
  );
}
