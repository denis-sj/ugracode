import './reports.css';
import type { JSX } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button,
  Card,
  EmptyState,
  Icon,
  InsightBlock,
  Segmented,
  countUp,
  fillBar,
  useListMotion,
} from '@ugra/ui';
import type { WebPageProps } from '@ugra/ui';
import {
  CARD_REPORTS,
  HERO_REPORT_ID,
  REPORTS,
  csvUrl,
  errorMessage,
  findReport,
  formatAnswer,
  formatShiftDate,
  hotspotFocus,
  insightView,
  isKnownReportPayload,
  isReportError,
  numberRows,
  reportFacts,
  reportIsEmpty,
  reportTable,
  runBody,
  summaryAnswer,
  summaryUrl,
  todayIso,
} from './format';
import type { AnswerUnit, HotspotFocusView, ReportAnswer, ReportSpec } from './format';

/**
 * Страница `/reports`: один главный вопрос (О2 «Что ломается снова») и шесть
 * карточек-вопросов О1, О3–О7. Цифры считает сервер кодом; вывод ИИ — внутри отчёта.
 */

const PERIODS = [
  { value: '7', label: '7 дней' },
  { value: '30', label: '30 дней' },
  { value: '90', label: '90 дней' },
] as const;

const MAX_ROWS = 12;

type Period = '7' | '30' | '90';

type SummaryState =
  | { kind: 'loading' }
  | { kind: 'done'; payload: unknown }
  | { kind: 'error' };

type RunState =
  | { kind: 'running'; payload: null; message: null }
  | { kind: 'done'; payload: unknown; message: null }
  | { kind: 'error'; payload: null; message: string };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Анимированная цифра ответа: «набегает» от прошлого значения, уважает «Уменьшить движение». */
function AnswerValue({ answer }: { answer: ReportAnswer }): JSX.Element {
  const ref = useRef<HTMLSpanElement | null>(null);
  const previous = useRef(0);
  const numeric = typeof answer.value === 'number' ? answer.value : null;

  useEffect(() => {
    if (numeric === null || ref.current === null) return undefined;
    const from = previous.current;
    previous.current = numeric;
    return countUp(ref.current, numeric, {
      from,
      format: (next) => formatAnswer({ ...answer, value: next }),
    });
  }, [numeric, answer]);

  return (
    <span
      className={answer.unit === 'text' ? 'rp-answer__value rp-answer__value--text' : 'rp-answer__value'}
      ref={ref}
    >
      {formatAnswer(answer)}
    </span>
  );
}

/** Полоски горячих точек: ширина из числа заявок, наполнение — через `fillBar`. */
function HotspotBars({ focus }: { focus: HotspotFocusView }): JSX.Element {
  const refs = useRef<Array<HTMLSpanElement | null>>([]);

  useEffect(() => {
    focus.bars.forEach((_bar, index) => fillBar(refs.current[index], 0.1 + index * 0.08));
  }, [focus]);

  return (
    <div className="rp-bars" role="list">
      {focus.bars.map((bar, index) => (
        <div className="rp-bars__row" role="listitem" key={bar.key}>
          <span className="rp-bars__label">{bar.label}</span>
          <span className="rp-bars__track">
            <span
              className={index === 0 ? 'rp-bars__fill rp-bars__fill--top' : 'rp-bars__fill'}
              style={{ width: `${bar.width}%` }}
              ref={(node) => {
                refs.current[index] = node;
              }}
            />
          </span>
          <span className="rp-bars__count">{bar.count}</span>
        </div>
      ))}
    </div>
  );
}

function ReportHero({
  state,
  onOpen,
}: {
  state: SummaryState | undefined;
  onOpen: () => void;
}): JSX.Element {
  const focus = state?.kind === 'done' ? hotspotFocus(state.payload) : null;

  return (
    <Card glass className="rp-hero" data-reveal>
      <div className="rp-hero__main">
        <span className="rp-tag">
          <i>О2</i>
          Горячие точки
        </span>
        <h2 className="rp-hero__question">Что ломается снова и снова?</h2>

        {focus === null ? (
          <p className="rp-hero__wait">
            {state === undefined || state.kind === 'loading'
              ? 'Считаем повторы…'
              : 'Повторных поломок за период нет.'}
          </p>
        ) : (
          <>
            <p className="rp-hero__place">{focus.label}</p>
            <p className="rp-hero__caption">
              {focus.caption}
              {focus.trend !== null && <span className="rp-hero__trend">{focus.trend}</span>}
            </p>
            <Button variant="primary" onClick={onOpen} className="rp-hero__cta">
              Открыть отчёт
            </Button>
          </>
        )}
      </div>

      {focus !== null && <HotspotBars focus={focus} />}
    </Card>
  );
}

function AnswerBlock({ answer }: { answer: ReportAnswer | null }): JSX.Element {
  if (answer === null) {
    return <p className="rp-card__nodata">Пока нет данных за период</p>;
  }
  return (
    <div className="rp-answer">
      <span className={answer.unit === 'text' ? 'rp-answer__value rp-answer__value--text' : 'rp-answer__value'}>
        <AnswerValueText answer={answer} />
      </span>
      <span className="rp-answer__caption">{answer.caption}</span>
      {answer.hint !== null && <span className="rp-answer__hint">{answer.hint}</span>}
    </div>
  );
}

/** Обёртка без повторного `span`: текст ответа — внутри одного элемента. */
function AnswerValueText({ answer }: { answer: ReportAnswer }): JSX.Element {
  return <AnswerValue answer={answer} />;
}

function ReportCard({
  spec,
  state,
  onOpen,
}: {
  spec: ReportSpec;
  state: SummaryState | undefined;
  onOpen: () => void;
}): JSX.Element {
  const answer = state?.kind === 'done' ? summaryAnswer(spec.id, state.payload) : null;

  return (
    <Card as="article" interactive className="rp-card" data-reveal>
      <button
        type="button"
        className="rp-card__hit"
        onClick={onOpen}
        aria-label={`Открыть отчёт ${spec.code}: ${spec.title}`}
      />
      <div className="rp-card__head">
        <span className="rp-card__code">{spec.code}</span>
        <span className="rp-card__go" aria-hidden="true">
          <Icon name="reports" size={14} />
        </span>
      </div>
      <h2 className="rp-card__question">{spec.question}</h2>
      <AnswerBlock answer={answer} />
    </Card>
  );
}

function ReportTable({ spec, payload, days, date }: { spec: ReportSpec; payload: unknown; days: number; date: string }): JSX.Element | null {
  const tbodyRef = useRef<HTMLTableSectionElement | null>(null);
  const table = reportTable(payload);
  const rows = table === null ? [] : table.rows.slice(0, MAX_ROWS);
  const totalRows = numberRows(payload);
  useListMotion(tbodyRef, rows.length > 0);

  if (table === null || rows.length === 0) return null;

  return (
    <div className="rp-table-wrap">
      <table className="rp-table">
        <thead>
          <tr>
            {table.columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody ref={tbodyRef}>
          {rows.map((row) => (
            <tr key={row.key}>
              {row.cells.map((cell, index) => (
                <td key={`${row.key}-${index}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="rp-table__foot">
        {totalRows > MAX_ROWS && (
          <span className="rp-note">
            Первые {MAX_ROWS} из {totalRows} строк — полностью в CSV.
          </span>
        )}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => window.open(csvUrl(spec.id, days, date), '_blank', 'noopener,noreferrer')}
        >
          Скачать CSV
        </Button>
      </div>
    </div>
  );
}

function ReportBody({
  spec,
  state,
  days,
  date,
  onRetry,
}: {
  spec: ReportSpec;
  state: RunState;
  days: number;
  date: string;
  onRetry: () => void;
}): JSX.Element {
  if (state.kind === 'running') {
    return (
      <p className="rp-status" role="status">
        <span className="rp-spinner" aria-hidden="true" />
        Считаем отчёт: цифры по базе и вывод модели.
      </p>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="rp-error" role="alert">
        <div>
          <b>Не удалось сформировать отчёт</b>
          <p className="rp-error__text">{state.message}</p>
        </div>
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Повторить
        </Button>
      </div>
    );
  }

  if (!isKnownReportPayload(state.payload)) {
    return (
      <div className="rp-error" role="alert">
        <div>
          <b>Незнакомый формат ответа</b>
          <p className="rp-error__text">Сервер ответил иначе, чем ждёт хаб отчётов.</p>
        </div>
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Повторить
        </Button>
      </div>
    );
  }

  const facts = reportFacts(state.payload);
  const insight = insightView(state.payload);

  return (
    <>
      {reportIsEmpty(state.payload) && (
        <EmptyState
          title="За период данных нет"
          hint="Попробуйте другой период — или проверьте, что заявки поступали."
          icon={<Icon name="reports" size={28} />}
        />
      )}

      {facts.length > 0 && (
        <div className="rp-metrics">
          {facts.slice(0, 5).map((fact) => (
            <div className="rp-metric" key={fact.label}>
              <span className="rp-metric__label">{fact.label}</span>
              <span className="rp-metric__value">{fact.value}</span>
            </div>
          ))}
        </div>
      )}

      {insight.meaning !== null && <InsightBlock kind="meaning">{insight.meaning}</InsightBlock>}

      {insight.actions.length > 0 && (
        <InsightBlock kind="action">
          <ul className="rp-actions">
            {insight.actions.map((action, index) => (
              <li key={`${index}-${action.slice(0, 24)}`}>{action}</li>
            ))}
          </ul>
        </InsightBlock>
      )}

      <ReportTable spec={spec} payload={state.payload} days={days} date={date} />
    </>
  );
}

function ReportDetail({
  spec,
  days,
  date,
  api,
  onDate,
  onBack,
}: {
  spec: ReportSpec;
  days: number;
  date: string;
  api: WebPageProps['api'];
  onDate: (value: string) => void;
  onBack: () => void;
}): JSX.Element {
  const [state, setState] = useState<RunState>({ kind: 'running', payload: null, message: null });

  const run = useCallback(async (): Promise<void> => {
    setState({ kind: 'running', payload: null, message: null });
    try {
      const payload = await api.post<unknown>(spec.endpoint, runBody(spec, days, date));
      if (isReportError(payload)) {
        setState({
          kind: 'error',
          payload: null,
          message: errorMessage(payload) ?? 'Сервер вернул ошибку без текста.',
        });
      } else {
        setState({ kind: 'done', payload, message: null });
      }
    } catch (error) {
      setState({ kind: 'error', payload: null, message: errorText(error) });
    }
  }, [api, days, date, spec]);

  useEffect(() => {
    void run();
  }, [run]);

  return (
    <section className="rp-detail" data-reveal>
      <div className="rp-detail__head">
        <Button variant="ghost" size="sm" onClick={onBack} className="rp-back">
          ← Все отчёты
        </Button>
        <span className="rp-detail__topic">{spec.title}</span>
        {spec.params === 'date' && (
          <label className="rp-date">
            <span className="rp-date__label">Смена</span>
            <input
              type="date"
              className="rp-date__input"
              value={date}
              onChange={(event) => onDate(event.target.value)}
              aria-label="Дата смены"
            />
          </label>
        )}
      </div>

      <ReportBody spec={spec} state={state} days={days} date={date} onRetry={() => void run()} />
    </section>
  );
}

export function ReportsPage({ api, navigate, query, trackAction }: WebPageProps): JSX.Element {
  const [period, setPeriod] = useState<Period>('30');
  const [date, setDate] = useState(todayIso);
  const [summaries, setSummaries] = useState<Record<string, SummaryState>>({});
  const days = Number(period);
  const openId = query.get('report');
  const openSpec = openId === null ? undefined : findReport(openId);

  useEffect(() => {
    let alive = true;
    const load = async (): Promise<void> => {
      setSummaries(Object.fromEntries(REPORTS.map((spec) => [spec.id, { kind: 'loading' }])));
      const results = await Promise.all(
        REPORTS.map(async (spec): Promise<[string, SummaryState]> => {
          try {
            const payload = await api.get<unknown>(summaryUrl(spec, days, date));
            return [spec.id, { kind: 'done', payload }];
          } catch {
            return [spec.id, { kind: 'error' }];
          }
        }),
      );
      if (alive) setSummaries(Object.fromEntries(results));
    };
    void load();
    return () => {
      alive = false;
    };
  }, [api, days, date]);

  const open = (spec: ReportSpec): void => {
    trackAction?.('navigate');
    navigate(`/reports?report=${spec.id}`);
  };

  return (
    <div className="rp-page">
      <header className="rp-head" data-reveal>
        <div className="rp-head__titles">
          <h1 className="ugra-page-title rp-title">
            {openSpec === undefined ? 'Отчёты' : openSpec.question}
          </h1>
          <p className="rp-sub">{openSpec === undefined ? 'Семь вопросов — семь ответов.' : openSpec.title}</p>
        </div>
        <Segmented
          value={period}
          label="Период отчётов"
          options={PERIODS}
          onChange={(value) => {
            trackAction?.('select');
            setPeriod(value);
          }}
        />
      </header>

      {openSpec === undefined ? (
        <>
          <ReportHero
            state={summaries[HERO_REPORT_ID]}
            onOpen={() => {
              const hero = findReport(HERO_REPORT_ID);
              if (hero) open(hero);
            }}
          />
          <div className="rp-grid">
            {CARD_REPORTS.map((spec) => (
              <ReportCard
                key={spec.id}
                spec={spec}
                state={summaries[spec.id]}
                onOpen={() => open(spec)}
              />
            ))}
          </div>
        </>
      ) : (
        <ReportDetail
          spec={openSpec}
          days={days}
          date={date}
          api={api}
          onDate={setDate}
          onBack={() => navigate('/reports')}
        />
      )}

      <p className="rp-source">Данные — синтетическая история за 6 месяцев.</p>
    </div>
  );
}
