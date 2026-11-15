import './journal.css';
import type { EventsResponse, TicketListResponse, UsersResponse } from '@ugra/contracts';
import type { JSX } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, EmptyState, PersonAvatar, formatTicketNumber, useListMotion } from '@ugra/ui';
import type { WebPageProps } from '@ugra/ui';
import {
  DEFAULT_JOURNAL_FILTERS,
  EVENTS_IN_BLOCK,
  filterEvents,
  fullTime,
  relativeTime,
  serviceEventCount,
  shortPersonName,
  toJournalRows,
} from './format';
import type { DiffSegment, JournalDiff, JournalRow } from './format';
import { useNow } from './useNow';

const EVENTS_URL = '/api/events?limit=300';

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Фрагменты значения: отличающееся слово — жирным, без второй подсветки поверх плашки. */
function Segments({ segments }: { segments: readonly DiffSegment[] }): JSX.Element {
  if (segments.length === 0) return <span>—</span>;
  return (
    <>
      {segments.map((segment, index) =>
        segment.changed ? (
          <span className="journal-diff__changed" key={index}>
            {segment.text}
          </span>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}

interface DiffProps {
  diff: JournalDiff;
  /** `fix` — правка поля (старое красным, новое зелёным), `plain` — спокойная строка таблицы. */
  tone: 'fix' | 'plain';
}

/** «Было → стало»: старое зачёркнуто и приглушено, новое — акцентом. */
function Diff({ diff, tone }: DiffProps): JSX.Element {
  return (
    <span className={`journal-diff journal-diff--${tone}`}>
      <s className="journal-was">
        <Segments segments={diff.beforeSegments} />
      </s>
      <span className="journal-arr" aria-hidden="true">
        →
      </span>
      <strong className="journal-now">
        <Segments segments={diff.afterSegments} />
      </strong>
    </span>
  );
}

interface RowProps {
  row: JournalRow;
  now: number;
  onNavigate: () => void;
}

/** Строка журнала: когда, кто, что изменилось, заявка — по колонкам с заголовками. */
function JournalTableRow({ row, now, onNavigate }: RowProps): JSX.Element {
  const ticket =
    row.ticketId === null || row.ticketNumber === null
      ? null
      : { id: row.ticketId, label: formatTicketNumber(row.ticketNumber) };

  return (
    <tr className="journal-row">
      <td className="journal-cell journal-cell--time">
        <time dateTime={row.at ?? undefined} title={fullTime(row.at)}>
          {relativeTime(row.at, now)}
        </time>
      </td>
      <td className="journal-cell journal-cell--who">
        <span className="journal-person">
          <PersonAvatar name={row.actor} size={26} />
          <span className="journal-who">{shortPersonName(row.actor)}</span>
        </span>
      </td>
      <td className="journal-cell journal-cell--what">
        <b className="journal-what">{row.title}</b>
        {row.description !== null && <span className="journal-what__note">{row.description}</span>}
        {row.diff !== null && <Diff diff={row.diff} tone="plain" />}
      </td>
      <td className="journal-cell journal-cell--ticket">
        {ticket === null ? (
          <span className="journal-ticket journal-ticket--none">—</span>
        ) : (
          <a
            className="journal-ticket"
            href={`#/review?id=${encodeURIComponent(ticket.id)}`}
            title={`Открыть заявку ${ticket.label}`}
            onClick={onNavigate}
          >
            {ticket.label}
          </a>
        )}
      </td>
    </tr>
  );
}

/** Пустой журнал: отличаем «событий нет» и «только служебные шаги». */
function emptyCopy(service: number): { title: string; hint: string } {
  if (service > 0) {
    return {
      title: 'Здесь только служебные события',
      hint: 'Шаги разбора и агента скрыты: диспетчеру они ничего не говорят. Загляните позже.',
    };
  }
  return {
    title: 'Журнал пока пуст',
    hint: 'События появляются сами: разбор обращения, правки полей, подтверждения и аварии.',
  };
}

/** Журнал действий (экран 07): одна таблица — когда, кто, что изменилось, заявка. За 7 дней. */
export function JournalPage({ meta, api, trackAction }: WebPageProps): JSX.Element {
  const [events, setEvents] = useState<readonly unknown[]>([]);
  const [users, setUsers] = useState<UsersResponse['users']>([]);
  const [tickets, setTickets] = useState<TicketListResponse['tickets']>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [showAllEvents, setShowAllEvents] = useState(false);

  const tableRef = useRef<HTMLTableSectionElement | null>(null);
  const now = useNow();

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    void api
      .get<EventsResponse>(EVENTS_URL)
      .then(async (response) => {
        if (!alive) return;
        setEvents(Array.isArray(response.events) ? response.events : []);
        // Справочники — только для подписей: без них журнал всё равно показывается.
        const [usersResponse, ticketsResponse] = await Promise.all([
          api.get<UsersResponse>('/api/users').catch(() => null),
          api.get<TicketListResponse>('/api/tickets?limit=200').catch(() => null),
        ]);
        if (!alive) return;
        setUsers(usersResponse?.users ?? []);
        setTickets(ticketsResponse?.tickets ?? []);
      })
      .catch((cause: unknown) => {
        if (alive) setError(errorText(cause));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [api, refreshToken]);

  const rows = useMemo(
    () => toJournalRows(events, { users, tickets, fields: meta.fields, dictionaries: meta.dictionaries }),
    [events, users, tickets, meta],
  );
  const visible = useMemo(() => filterEvents(rows, DEFAULT_JOURNAL_FILTERS, now), [rows, now]);
  const hiddenService = useMemo(
    () => serviceEventCount(rows, DEFAULT_JOURNAL_FILTERS.period, now),
    [rows, now],
  );

  useListMotion(tableRef, visible.length > 0);

  const empty = emptyCopy(hiddenService);
  /** Последние события в таблице; остальные — по кнопке «Показать ещё». */
  const tableRows = showAllEvents ? visible : visible.slice(0, EVENTS_IN_BLOCK);
  const hiddenRows = visible.length - tableRows.length;

  return (
    <div className="journal-page">
      <header className="journal-top" data-reveal>
        <h1 className="ugra-page-title">Журнал</h1>
        <p className="journal-lead">Кто, что и когда изменил в заявках за 7 дней.</p>
      </header>

      {error !== null && (
        <Card tone="danger" className="journal-error">
          <h2 className="journal-error__title">API не отвечает</h2>
          <p className="ugra-muted">{error}</p>
          <Button variant="secondary" size="sm" onClick={() => setRefreshToken((value) => value + 1)}>
            Повторить
          </Button>
        </Card>
      )}

      {error === null && loading && rows.length === 0 && (
        <Card padded={false} className="journal-card">
          <div className="journal-skeleton" aria-label="Загружаем журнал">
            {[0, 1, 2, 3, 4].map((index) => (
              <span className="journal-skeleton__line" key={index} />
            ))}
          </div>
        </Card>
      )}

      {error === null && !loading && visible.length === 0 && <EmptyState title={empty.title} hint={empty.hint} />}

      {error === null && visible.length > 0 && (
        <Card padded={false} className="journal-card journal-feed">
          <div className="journal-feed__head">
            <h2 className="journal-sec">Журнал действий</h2>
            <span className="journal-feed__total">Всего событий: {visible.length}</span>
          </div>
          <div className="journal-table-scroll">
            <table className="journal-table" aria-label="События журнала">
              <colgroup>
                <col className="journal-col-time" />
                <col className="journal-col-who" />
                <col />
                <col className="journal-col-ticket" />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">Когда</th>
                  <th scope="col">Кто</th>
                  <th scope="col">Что изменилось</th>
                  <th scope="col">Заявка</th>
                </tr>
              </thead>
              <tbody ref={tableRef}>
                {tableRows.map((row) => (
                  <JournalTableRow key={row.id} row={row} now={now} onNavigate={() => trackAction?.('navigate')} />
                ))}
              </tbody>
            </table>
          </div>
          {(hiddenRows > 0 || hiddenService > 0) && (
            <div className="journal-feed__foot">
              {hiddenService > 0 ? (
                <p className="journal-feed__note" title="Шаги разбора, шаги агента и заполнение полей ИИ">
                  Скрыто служебных событий: {hiddenService}
                </p>
              ) : (
                <span />
              )}
              {hiddenRows > 0 && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setShowAllEvents(true);
                    trackAction?.('click');
                  }}
                >
                  Показать ещё {hiddenRows}
                </Button>
              )}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
