import './journal.css';
import type { EventsResponse, TicketListResponse, UsersResponse } from '@ugra/contracts';
import type { JSX } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Card,
  EmptyState,
  PersonAvatar,
  Segmented,
  fillBar,
  formatTicketNumber,
  useListMotion,
} from '@ugra/ui';
import type { WebPageProps } from '@ugra/ui';
import {
  DEFAULT_JOURNAL_FILTERS,
  EVENTS_IN_BLOCK,
  correctedCaption,
  correctedFieldLabel,
  correctedSummary,
  eventGroups,
  filterEvents,
  fullTime,
  pairLabel,
  periodLabel,
  plural,
  relativeTime,
  serviceEventCount,
  shortPersonName,
  splitJournal,
  toJournalRows,
  topCorrectedFields,
  trainingExamples,
} from './format';
import type {
  CorrectedField,
  CorrectedSummary,
  DiffSegment,
  JournalDiff,
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

/** Одна правка в блоке «ИИ предложил → человек исправил»: автор, поле, «было → стало», время. */
function FixRow({ row, now, onNavigate }: RowProps): JSX.Element {
  const ticket =
    row.ticketId === null || row.ticketNumber === null
      ? null
      : { id: row.ticketId, label: formatTicketNumber(row.ticketNumber) };

  return (
    <article className="journal-fix">
      <PersonAvatar name={row.actor} size={30} />
      <div className="journal-fix__body">
        <h3 className="journal-fix__title">
          {shortPersonName(row.actor)}
          <span className="journal-fix__field"> · {correctedFieldLabel(row)}</span>
        </h3>
        {row.diff !== null && <Diff diff={row.diff} tone="fix" />}
      </div>
      <div className="journal-fix__meta">
        <time className="journal-fix__time" dateTime={row.at ?? undefined} title={fullTime(row.at)}>
          {relativeTime(row.at, now)}
        </time>
        {ticket !== null && (
          <a
            className="journal-fix__num"
            href={`#/review?id=${encodeURIComponent(ticket.id)}`}
            title={`Открыть заявку ${ticket.label}`}
            onClick={onNavigate}
          >
            {ticket.label}
          </a>
        )}
      </div>
    </article>
  );
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

/** Полоска «что чаще исправляют»: ширина — доля поля от всех правок, наполнение через `fillBar`. */
function FieldBar({ field, index }: { field: CorrectedField; index: number }): JSX.Element {
  const fillRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    fillBar(fillRef.current, index * 0.08);
  }, [index, field.fieldKey, field.share]);

  const hint = pairLabel(field.pair);

  return (
    <div className="journal-bar">
      <div className="journal-bar__row">
        <span>{field.label}</span>
        <em>{field.count}</em>
      </div>
      <span
        className="journal-bar__track"
        role="img"
        aria-label={`${field.label}: ${field.count}, ${field.percent}% правок`}
      >
        <span className="journal-bar__fill" ref={fillRef} style={{ width: `${field.percent}%` }} />
      </span>
      {hint !== null && (
        <small className="journal-bar__hint" title={hint}>
          {hint}
        </small>
      )}
    </div>
  );
}

interface TopFieldsProps {
  fields: readonly CorrectedField[];
  summary: CorrectedSummary;
  period: JournalPeriod;
  loading: boolean;
}

/** Правая карточка «Что чаще исправляют»: компактный топ и одна строка вывода. */
function TopFields({ fields, summary, period, loading }: TopFieldsProps): JSX.Element {
  return (
    <Card as="aside" className="journal-aside">
      <h2 className="journal-aside__title">Что чаще исправляют</h2>
      {loading ? (
        <p className="journal-aside__lead">Считаем правки…</p>
      ) : fields.length === 0 ? (
        <p className="journal-aside__empty">
          {periodLabel(period)} правок не было — здесь появится топ полей, которые ИИ путает чаще всего.
        </p>
      ) : (
        <>
          <p className="journal-aside__lead">{correctedCaption(summary, period)}</p>
          <div className="journal-bars" data-reveal>
            {fields.map((field, index) => (
              <FieldBar key={field.fieldKey === '' ? 'empty' : field.fieldKey} field={field} index={index} />
            ))}
          </div>
          <p className="journal-tip">
            Правки уходят в настройку: <strong>ИИ учится {trainingExamples(summary.corrections)}</strong>.
          </p>
        </>
      )}
    </Card>
  );
}

interface EmptyCopy {
  title: string;
  hint: string;
}

/** Тексты пустого состояния: отличаем «журнал пуст», «только служебное» и «вкладка пуста». */
function emptyCopy(hasAny: boolean, inPeriod: number, service: number, period: JournalPeriod): EmptyCopy {
  if (!hasAny) {
    return {
      title: 'Журнал пока пуст',
      hint: 'События появляются сами: разбор обращения, правки полей, подтверждения и аварии.',
    };
  }
  if (inPeriod === 0) {
    if (service > 0) {
      return {
        title: 'Здесь только служебные события',
        hint: 'Шаги разбора и агента скрыты: диспетчеру они ничего не говорят. Загляните позже или выберите «7 дней».',
      };
    }
    return period === 'today'
      ? { title: 'Сегодня событий нет', hint: 'Выберите «7 дней» — там есть вчерашние события.' }
      : { title: 'За 7 дней событий нет', hint: 'Журнал наполняется сам, как только диспетчеры начнут работать.' };
  }
  return {
    title: 'В этой вкладке пусто',
    hint: 'Выберите другую вкладку или вернитесь ко «Все»: в журнале есть другие события.',
  };
}

/** Журнал действий (экран 07): правки ИИ, таблица событий, топ исправляемых полей. */
export function JournalPage({ meta, api, trackAction }: WebPageProps): JSX.Element {
  const [events, setEvents] = useState<readonly unknown[]>([]);
  const [users, setUsers] = useState<UsersResponse['users']>([]);
  const [tickets, setTickets] = useState<TicketListResponse['tickets']>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<JournalFilters>(DEFAULT_JOURNAL_FILTERS);
  const [refreshToken, setRefreshToken] = useState(0);
  const [showAllEvents, setShowAllEvents] = useState(false);

  const fixesRef = useRef<HTMLDivElement | null>(null);
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

  /** Период и служебный шум: один источник для счётчиков вкладок, списка и сводки справа. */
  const baseRows = useMemo(
    () => filterEvents(rows, { ...filters, group: 'all' }, now),
    [rows, filters.period, now],
  );
  const visible = useMemo(() => filterEvents(rows, filters, now), [rows, filters, now]);
  const feed = useMemo(() => splitJournal(visible), [visible]);
  const summary = useMemo(() => correctedSummary(rows, filters.period, now), [rows, filters.period, now]);
  const topFields = useMemo(() => topCorrectedFields(baseRows, 3), [baseRows]);
  const hiddenService = useMemo(
    () => serviceEventCount(rows, filters.period, now),
    [rows, filters.period, now],
  );

  useListMotion(fixesRef, feed.fixes.length > 0);
  useListMotion(tableRef, feed.rest.length > 0);

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
    filters.group !== DEFAULT_JOURNAL_FILTERS.group || filters.period !== DEFAULT_JOURNAL_FILTERS.period;

  const changeGroup = (group: JournalGroupId): void => {
    setFilters((previous) => ({ ...previous, group }));
    setShowAllEvents(false);
    trackAction?.('select');
  };

  const changePeriod = (period: JournalPeriod): void => {
    setFilters((previous) => ({ ...previous, period }));
    setShowAllEvents(false);
    trackAction?.('select');
  };

  const reset = (): void => {
    setFilters(DEFAULT_JOURNAL_FILTERS);
    setShowAllEvents(false);
    trackAction?.('select');
  };

  const empty = emptyCopy(rows.length > 0, baseRows.length, hiddenService, filters.period);
  const showFixes = filters.group === 'all' || filters.group === 'edits';
  /** Пять последних событий в таблице; остальные — по кнопке «Показать ещё». */
  const tableRows = showAllEvents ? feed.rest : feed.rest.slice(0, EVENTS_IN_BLOCK);
  const hiddenRows = feed.rest.length - tableRows.length;

  return (
    <div className="journal-page">
      <header className="journal-top" data-reveal>
        <h1 className="ugra-page-title">Журнал</h1>
        <div className="journal-top__filters">
          <Segmented
            value={filters.group}
            label="Что показывать"
            options={groupOptions}
            onChange={changeGroup}
          />
          <Segmented
            value={filters.period}
            label="Период журнала"
            className="journal-period"
            options={PERIODS}
            onChange={changePeriod}
          />
        </div>
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

      {error === null && (
        <div className="journal-grid">
          <div className="journal-col">
            {loading && rows.length === 0 && (
              <Card padded={false} className="journal-card">
                <div className="journal-skeleton" aria-label="Загружаем журнал">
                  {[0, 1, 2, 3, 4].map((index) => (
                    <span className="journal-skeleton__line" key={index} />
                  ))}
                </div>
              </Card>
            )}

            {!loading && visible.length === 0 && (
              <EmptyState title={empty.title} hint={empty.hint}>
                {filtersActive && (
                  <Button variant="secondary" size="sm" onClick={reset}>
                    Сбросить фильтры
                  </Button>
                )}
              </EmptyState>
            )}

            {visible.length > 0 && (
              <>
                {showFixes && (
                  <Card padded={false} className="journal-card">
                    <h2 className="journal-sec">ИИ предложил → человек исправил</h2>
                    {feed.fixes.length === 0 ? (
                      <p className="journal-empty-note">
                        Пока никто не правил поля ИИ. Как только диспетчер исправит предложенное значение, пара
                        «было → стало» появится здесь.
                      </p>
                    ) : (
                      <>
                        <div className="journal-fix-list" ref={fixesRef}>
                          {feed.fixes.map((row) => (
                            <FixRow
                              key={row.id}
                              row={row}
                              now={now}
                              onNavigate={() => trackAction?.('navigate')}
                            />
                          ))}
                        </div>
                        {feed.hiddenFixes > 0 && (
                          <p className="journal-sec__more">
                            Ещё {feed.hiddenFixes} {plural(feed.hiddenFixes, 'правка', 'правки', 'правок')} —
                            в журнале ниже
                          </p>
                        )}
                      </>
                    )}
                  </Card>
                )}

                {feed.rest.length > 0 && (
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
                            <JournalTableRow
                              key={row.id}
                              row={row}
                              now={now}
                              onNavigate={() => trackAction?.('navigate')}
                            />
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {(hiddenRows > 0 || hiddenService > 0) && (
                      <div className="journal-feed__foot">
                        {hiddenService > 0 ? (
                          <p
                            className="journal-feed__note"
                            title="Шаги разбора, шаги агента и заполнение полей ИИ"
                          >
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
              </>
            )}
          </div>

          <TopFields
            fields={topFields}
            summary={summary}
            period={filters.period}
            loading={loading && rows.length === 0}
          />
        </div>
      )}
    </div>
  );
}
