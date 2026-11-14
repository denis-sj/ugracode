import './journal.css';
import type { EventsResponse, TicketListResponse, UsersResponse } from '@ugra/contracts';
import type { JSX } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, EmptyState, Icon, PersonAvatar, Segmented, fillBar, useListMotion } from '@ugra/ui';
import type { IconName, WebPageProps } from '@ugra/ui';
import {
  DEFAULT_JOURNAL_FILTERS,
  REST_IN_BLOCK,
  actorSuffix,
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
  shortTicketNumber,
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

/** Иконка строки события: набор `@ugra/ui`, нового SVG на экране нет. */
const EVENT_ICONS: Record<string, IconName> = {
  'appeal.created': 'chat',
  'message.sent': 'chat',
  'analysis.started': 'reports',
  'analysis.completed': 'reports',
  'ticket.field.set': 'reports',
  'ticket.field.corrected': 'tasks',
  'ticket.confirmed': 'tasks',
  'ticket.assigned': 'tasks',
  'ticket.status.changed': 'tasks',
  'emergency.detected': 'incidents',
  'mass-incident.opened': 'incidents',
  'ticket.deadline.extended': 'journal',
  'ticket.returned': 'journal',
  'setting.changed': 'journal',
};

function eventIcon(type: string): IconName {
  return EVENT_ICONS[type] ?? 'journal';
}

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
  /** `fix` — правка поля (старое красным, новое зелёным), `plain` — статус без цветных плашек. */
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

/** Одна правка в верхнем блоке: автор, поле, «было → стало», время и номер заявки. */
function FixRow({ row, now, onNavigate }: RowProps): JSX.Element {
  return (
    <article className="journal-fix">
      <PersonAvatar name={row.actor} size={44} />
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
        {row.ticketId !== null && row.ticketNumber !== null && (
          <a
            className="journal-fix__num"
            href={`#/review?id=${encodeURIComponent(row.ticketId)}`}
            title={`Заявка № ${row.ticketNumber}`}
            onClick={onNavigate}
          >
            № {shortTicketNumber(row.ticketNumber)}
          </a>
        )}
      </div>
    </article>
  );
}

/** Номер заявки и подробность события — вторая строка списка. */
function EventMeta({ row, onNavigate }: { row: JournalRow; onNavigate: () => void }): JSX.Element | null {
  const number = row.ticketNumber;
  const hasNumber = row.ticketId !== null && number !== null;
  if (!hasNumber && row.description === null) return null;
  return (
    <small className="journal-event__meta">
      {hasNumber && (
        <>
          <a
            className="journal-event__num"
            href={`#/review?id=${encodeURIComponent(row.ticketId ?? '')}`}
            title={`Заявка № ${number}`}
            onClick={onNavigate}
          >
            № {shortTicketNumber(number)}
          </a>
          {row.description !== null && <span aria-hidden="true"> · </span>}
        </>
      )}
      {row.description}
    </small>
  );
}

/** Строка «Остальные события»: иконка типа, человеческая подпись, автор, подробность и время. */
function EventRow({ row, now, onNavigate }: RowProps): JSX.Element {
  const who = actorSuffix(row);
  return (
    <article className="journal-event">
      <span className={`journal-event__icon journal-event__icon--${row.tone}`} aria-hidden="true">
        <Icon name={eventIcon(row.type)} size={18} />
      </span>
      <div className="journal-event__body">
        <b className="journal-event__title">
          {row.title}
          {who !== null && <span className="journal-event__actor"> · {who}</span>}
        </b>
        {row.diff !== null && <Diff diff={row.diff} tone="plain" />}
        <EventMeta row={row} onNavigate={onNavigate} />
      </div>
      <time className="journal-event__time" dateTime={row.at ?? undefined} title={fullTime(row.at)}>
        {relativeTime(row.at, now)}
      </time>
    </article>
  );
}

/** Полоска «что чаще исправляют»: ширина — доля от самого частого поля, наполнение через `fillBar`. */
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
        <span className="journal-bar__fill" ref={fillRef} style={{ width: `${field.share}%` }} />
      </span>
      {hint !== null && <small className="journal-bar__hint">{hint}</small>}
    </div>
  );
}

interface TopFieldsProps {
  fields: readonly CorrectedField[];
  summary: CorrectedSummary;
  period: JournalPeriod;
  loading: boolean;
}

/** Правая карточка «Что чаще исправляют»: топ полей и одна строка вывода. */
function TopFields({ fields, summary, period, loading }: TopFieldsProps): JSX.Element {
  return (
    <Card as="aside" className="journal-aside">
      <h2 className="journal-aside__title">Что чаще исправляют</h2>
      {loading ? (
        <p className="journal-aside__lead">Считаем правки…</p>
      ) : fields.length === 0 ? (
        <p className="journal-aside__empty">
          {periodLabel(period)} правок не было. Как только диспетчер поправит поле, которое предложил ИИ, здесь
          появится топ — что модель путает чаще всего.
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

/** Журнал действий (экран 07): правки ИИ, остальные события, топ исправляемых полей. */
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
  const restRef = useRef<HTMLDivElement | null>(null);
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
  useListMotion(restRef, feed.rest.length > 0);

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
  /** Один «лишний» ряд лучше показать сразу, чем кнопкой «Показать ещё 1». */
  const restRows =
    showAllEvents || feed.rest.length <= REST_IN_BLOCK + 1 ? feed.rest : feed.rest.slice(0, REST_IN_BLOCK);
  const restHidden = feed.rest.length - restRows.length;

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
                            Ещё {feed.hiddenFixes}{' '}
                            {plural(feed.hiddenFixes, 'правка', 'правки', 'правок')} — ниже, в остальных событиях
                          </p>
                        )}
                      </>
                    )}
                  </Card>
                )}

                <Card padded={false} className="journal-card">
                  <h2 className="journal-sec">Остальные события</h2>
                  <div className="journal-event-list" ref={restRef}>
                    {restRows.map((row) => (
                      <EventRow
                        key={row.id}
                        row={row}
                        now={now}
                        onNavigate={() => trackAction?.('navigate')}
                      />
                    ))}
                  </div>
                  {restHidden > 0 && (
                    <div className="journal-event-more">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setShowAllEvents(true);
                          trackAction?.('click');
                        }}
                      >
                        Показать ещё {restHidden}
                      </Button>
                    </div>
                  )}
                  {hiddenService > 0 && (
                    <p
                      className="journal-rest__note"
                      title="Шаги разбора, шаги агента и заполнение полей ИИ"
                    >
                      Скрыто служебных событий: {hiddenService}
                    </p>
                  )}
                </Card>
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
