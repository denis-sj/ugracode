import './journal.css';
import type { EventsResponse, TicketListResponse, UsersResponse } from '@ugra/contracts';
import type { JSX } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Card, EmptyState, SearchField, Segmented, useListMotion } from '@ugra/ui';
import type { WebPageProps } from '@ugra/ui';
import {
  DEFAULT_JOURNAL_FILTERS,
  eventGroups,
  filterEvents,
  fullTime,
  relativeTime,
  toJournalRows,
  topCorrectedFields,
} from './format';
import type {
  DiffSegment,
  JournalFilters,
  JournalGroupId,
  JournalPeriod,
  JournalRow,
} from './format';
import { useNow } from './useNow';

const EVENTS_URL = '/api/events?limit=300';

const PERIODS: ReadonlyArray<{ value: JournalPeriod; label: string }> = [
  { value: 'today', label: 'Сегодня' },
  { value: 'week', label: '7 дней' },
];

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Фрагменты «было → стало»: отличающееся подсвечено, остальное — обычным текстом. */
function Segments({ segments }: { segments: readonly DiffSegment[] }): JSX.Element {
  if (segments.length === 0) return <span>—</span>;
  return (
    <>
      {segments.map((segment, index) =>
        segment.changed ? (
          <mark className="journal-diff__changed" key={index}>
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}

interface RowProps {
  row: JournalRow;
  now: number;
  onNavigate: () => void;
}

/** Одна строка журнала: время, автор, событие, «было → стало» и номер заявки. */
function EventRow({ row, now, onNavigate }: RowProps): JSX.Element {
  return (
    <article className={`journal-row journal-row--${row.tone}`}>
      <time className="journal-row__time" dateTime={row.at ?? undefined} title={fullTime(row.at)}>
        {relativeTime(row.at, now)}
      </time>

      <span className="journal-row__actor" title={row.actor}>
        <i className="journal-row__dot" aria-hidden="true" />
        {row.actor}
      </span>

      <span className="journal-row__what">
        <span className="journal-row__title">{row.title}</span>
        {row.diff !== null && (
          <span className="journal-diff">
            <s className="journal-diff__before">
              <Segments segments={row.diff.beforeSegments} />
            </s>
            <span className="journal-diff__arrow" aria-hidden="true">
              →
            </span>
            <strong className="journal-diff__after">
              <Segments segments={row.diff.afterSegments} />
            </strong>
          </span>
        )}
        {row.description !== null && <span className="journal-row__note">{row.description}</span>}
      </span>

      {row.ticketId !== null && row.ticketNumber !== null ? (
        <a
          className="journal-row__num"
          href={`#/review?id=${encodeURIComponent(row.ticketId)}`}
          onClick={onNavigate}
        >
          № {row.ticketNumber}
        </a>
      ) : (
        <span className="journal-row__num journal-row__num--empty" aria-hidden="true" />
      )}
    </article>
  );
}

/** Журнал действий диспетчера (дизайн, экран 11): фильтры, строки и топ исправляемых полей. */
export function JournalPage({ meta, api, trackAction }: WebPageProps): JSX.Element {
  const [events, setEvents] = useState<readonly unknown[]>([]);
  const [users, setUsers] = useState<UsersResponse['users']>([]);
  const [tickets, setTickets] = useState<TicketListResponse['tickets']>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<JournalFilters>(DEFAULT_JOURNAL_FILTERS);
  const [refreshToken, setRefreshToken] = useState(0);

  const rowsRef = useRef<HTMLDivElement | null>(null);
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

  /** Число событий на вкладках — в текущем периоде и с учётом поиска. */
  const baseRows = useMemo(
    () => filterEvents(rows, { ...filters, group: 'all' }, now),
    [rows, filters.query, filters.period, now],
  );
  const visible = useMemo(() => filterEvents(rows, filters, now), [rows, filters, now]);
  const fixes = useMemo(() => topCorrectedFields(baseRows), [baseRows]);

  useListMotion(rowsRef, visible.length > 0);

  const groupOptions = useMemo(
    () =>
      eventGroups(baseRows).map((group) => ({
        value: group.id,
        label: group.label,
        count: group.count,
      })),
    [baseRows],
  );

  const filtersActive =
    filters.group !== DEFAULT_JOURNAL_FILTERS.group || filters.query !== '' || filters.period !== DEFAULT_JOURNAL_FILTERS.period;

  const changeGroup = (group: JournalGroupId): void => {
    setFilters((previous) => ({ ...previous, group }));
    trackAction?.('select');
  };

  const changePeriod = (period: JournalPeriod): void => {
    setFilters((previous) => ({ ...previous, period }));
    trackAction?.('select');
  };

  const reset = (): void => {
    setFilters(DEFAULT_JOURNAL_FILTERS);
    trackAction?.('select');
  };

  return (
    <div className="journal-page">
      <header className="journal-head" data-reveal>
        <div>
          <h1 className="ugra-page-title">Журнал действий</h1>
          <p className="journal-lead">
            Кто и что поменял в заявках. Правки «ИИ предложил → человек исправил» идут в настройку модели.
          </p>
        </div>
        <div className="journal-head__actions">
          <Badge tone="neutral">Событий: {baseRows.length}</Badge>
          <Button
            variant="secondary"
            size="sm"
            loading={loading}
            onClick={() => {
              setRefreshToken((value) => value + 1);
              trackAction?.('click');
            }}
          >
            Обновить
          </Button>
        </div>
      </header>

      <Card className="journal-toolbar" padded={false}>
        <div className="journal-toolbar__inner">
          <Segmented value={filters.group} label="Фильтр журнала" options={groupOptions} onChange={changeGroup} />
          <div className="journal-toolbar__right">
            <SearchField
              value={filters.query}
              label="Поиск по журналу"
              placeholder="Автор, заявка, поле, значение"
              onChange={(query) => {
                setFilters((previous) => ({ ...previous, query }));
                trackAction?.('input');
              }}
            />
            <Segmented
              value={filters.period}
              label="Период журнала"
              className="journal-period"
              options={PERIODS}
              onChange={changePeriod}
            />
          </div>
        </div>
      </Card>

      {error !== null && (
        <Card tone="danger" className="journal-error">
          <h2 className="journal-error__title">API не отвечает</h2>
          <p className="ugra-muted">{error}</p>
          <Button variant="secondary" size="sm" onClick={() => setRefreshToken((value) => value + 1)}>
            Повторить
          </Button>
        </Card>
      )}

      {error === null && (
        <div className="journal-layout">
          <Card className="journal-list" padded={false} as="section">
            <div className="journal-list__head">
              <h2 className="journal-list__title">События</h2>
              <span className="journal-list__count">{loading && rows.length === 0 ? 'загружаем…' : visible.length}</span>
            </div>

            {loading && rows.length === 0 && (
              <div className="journal-skeleton" aria-label="Загружаем журнал">
                {[0, 1, 2, 3, 4].map((index) => (
                  <span className="journal-skeleton__line" key={index} />
                ))}
              </div>
            )}

            {!loading && visible.length === 0 && (
              <EmptyState
                title={baseRows.length === 0 ? 'За период событий нет' : 'Под фильтры ничего не подошло'}
                hint={
                  baseRows.length === 0
                    ? 'Поменяйте период или дождитесь действий диспетчеров: журнал наполняется сам.'
                    : 'Измените вкладку или запрос — в журнале есть другие события.'
                }
              >
                {filtersActive && (
                  <Button variant="secondary" size="sm" onClick={reset}>
                    Сбросить фильтры
                  </Button>
                )}
              </EmptyState>
            )}

            {visible.length > 0 && (
              <div className="journal-rows" ref={rowsRef} data-reveal>
                {visible.map((row) => (
                  <EventRow key={row.id} row={row} now={now} onNavigate={() => trackAction?.('navigate')} />
                ))}
              </div>
            )}
          </Card>

          <aside className="journal-side">
            <Card className="journal-fixes">
              <h2 className="journal-fixes__title">Что чаще исправляют</h2>
              {fixes.length === 0 ? (
                <p className="journal-fixes__empty">
                  За период нет правок «ИИ предложил → человек исправил». Как только диспетчер поправит поле,
                  здесь появится топ.
                </p>
              ) : (
                <>
                  <p className="journal-fixes__caption">Топ-5 полей по правкам диспетчера</p>
                  <div className="journal-fixes__list">
                    {fixes.map((field) => (
                      <div className="journal-fix" key={field.fieldKey === '' ? 'empty' : field.fieldKey}>
                        <div className="journal-fix__row">
                          <span>{field.label}</span>
                          <b>{field.percent}%</b>
                        </div>
                        <span className="journal-fix__track">
                          <span className="journal-fix__fill" style={{ width: `${field.percent}%` }} />
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="journal-fixes__hint">
                    <strong>{fixes[0]?.label}</strong> ИИ путает чаще всего: подсказку для настройки модели
                    берём из этих правок.
                  </p>
                </>
              )}
            </Card>
          </aside>
        </div>
      )}
    </div>
  );
}
