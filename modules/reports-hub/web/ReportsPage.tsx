import './reports.css';
import type { JSX } from 'react';
import { useRef, useState } from 'react';
import { Button, InsightBlock, useListMotion } from '@ugra/ui';
import type { ApiClient, WebPageProps } from '@ugra/ui';
import {
  REPORTS,
  csvUrl,
  errorMessage,
  formatShiftDate,
  insightView,
  isKnownReportPayload,
  isReportError,
  numberRows,
  reportFacts,
  reportIsEmpty,
  reportTable,
  runBody,
  todayIso,
} from './format';
import type { ReportSpec } from './format';

/** Страница `/reports`: хаб отчётов О1–О7 на маршрутах серверных модулей. */

const PERIODS: readonly number[] = [7, 30, 90];

const MAX_ROWS = 10;

const EMPTY_HINT =
  'За выбранный период данных нет. Попробуйте другой период или проверьте, что заявки поступали.';

const UNKNOWN_HINT = 'Сервер ответил в формате, который хаб пока не разбирает.';

interface CardState {
  kind: 'done' | 'error';
  payload: unknown;
  message: string | null;
  days: number;
  date: string;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sourceLabel(source: 'ai' | 'template' | null, model: string | null): string | null {
  if (source === 'ai') return model === null ? 'вывод ИИ' : `вывод ИИ · ${model}`;
  if (source === 'template') return 'шаблонный вывод';
  return null;
}

function openCsv(spec: ReportSpec, state: CardState): void {
  window.open(csvUrl(spec.id, state.days, state.date), '_blank', 'noopener,noreferrer');
}

function ReportResult({
  spec,
  state,
  onCsv,
}: {
  spec: ReportSpec;
  state: CardState;
  onCsv: () => void;
}): JSX.Element {
  const tbodyRef = useRef<HTMLTableSectionElement | null>(null);
  const done = state.kind === 'done';
  const payload = state.payload;
  const known = done && isKnownReportPayload(payload);
  const table = known ? reportTable(payload) : null;
  const rows = table === null ? [] : table.rows.slice(0, MAX_ROWS);
  const totalRows = known ? numberRows(payload) : 0;
  useListMotion(tbodyRef, rows.length > 0);

  if (!done) {
    return (
      <div className="rh-error" role="alert">
        <div>
          <b>Не удалось сформировать отчёт</b>
          <p className="rh-error__text">{state.message ?? 'Сервер вернул ошибку без текста.'}</p>
        </div>
      </div>
    );
  }

  if (!known) {
    return (
      <div className="rh-result">
        <details className="rh-json">
          <summary>{UNKNOWN_HINT} Показать JSON</summary>
          <pre>{JSON.stringify(payload, null, 2)}</pre>
        </details>
        <div className="rh-result__footer">
          <Button variant="secondary" size="sm" onClick={onCsv}>
            Скачать CSV
          </Button>
          <span className="rh-note">Выгрузка за тот же период, откроется в новой вкладке.</span>
        </div>
      </div>
    );
  }

  const facts = reportFacts(payload);
  const insight = insightView(payload);
  const empty = reportIsEmpty(payload);
  const periodLabel = spec.params === 'date' ? formatShiftDate(state.date) : `${state.days} дней`;
  const note = sourceLabel(insight.source, insight.model);

  return (
    <div className="rh-result">
      <div className="rh-result__head">
        <span className="rh-result__period">Результат за {periodLabel}</span>
        {note !== null && <span className="rh-note">{note}</span>}
      </div>

      {facts.length > 0 && (
        <div className="rh-metrics">
          {facts.slice(0, 4).map((fact) => (
            <div className="rh-metric" key={fact.label}>
              <span className="rh-metric__label">{fact.label}</span>
              <span className="rh-metric__value">{fact.value}</span>
            </div>
          ))}
        </div>
      )}

      {empty && <p className="rh-empty">{EMPTY_HINT}</p>}

      {insight.meaning !== null && <InsightBlock kind="meaning">{insight.meaning}</InsightBlock>}

      {insight.actions.length > 0 && (
        <InsightBlock kind="action">
          <ul className="rh-actions">
            {insight.actions.map((action, index) => (
              <li key={`${index}-${action.slice(0, 24)}`}>{action}</li>
            ))}
          </ul>
        </InsightBlock>
      )}

      {table !== null && rows.length > 0 && (
        <div className="rh-table-wrap">
          <table className="rh-table">
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
          {totalRows > MAX_ROWS && (
            <p className="rh-note">
              Показаны первые {MAX_ROWS} строк из {totalRows}. Полностью — в CSV.
            </p>
          )}
        </div>
      )}

      {table === null && (
        <details className="rh-json">
          <summary>Строки отчёта в незнакомом формате. Показать JSON</summary>
          <pre>{JSON.stringify(payload, null, 2)}</pre>
        </details>
      )}

      <div className="rh-result__footer">
        <Button variant="secondary" size="sm" onClick={onCsv}>
          Скачать CSV
        </Button>
        <span className="rh-note">Выгрузка за тот же период, откроется в новой вкладке.</span>
      </div>
    </div>
  );
}

function ReportCard({
  spec,
  days,
  api,
  trackAction,
}: {
  spec: ReportSpec;
  days: number;
  api: ApiClient;
  trackAction?: WebPageProps['trackAction'];
}): JSX.Element {
  const [date, setDate] = useState(todayIso);
  const [running, setRunning] = useState(false);
  const [state, setState] = useState<CardState | null>(null);

  const run = async (): Promise<void> => {
    if (running) return;
    trackAction?.('click');
    setRunning(true);
    const period = { days, date };
    try {
      const payload = await api.post<unknown>(spec.endpoint, runBody(spec, days, date));
      if (isReportError(payload)) {
        setState({
          kind: 'error',
          payload: null,
          message: errorMessage(payload) ?? 'Сервер вернул ошибку без текста.',
          ...period,
        });
      } else {
        setState({ kind: 'done', payload, message: null, ...period });
      }
    } catch (error) {
      setState({ kind: 'error', payload: null, message: errorText(error), ...period });
    } finally {
      setRunning(false);
    }
  };

  return (
    <article className="ugra-card ugra-card--padded rh-card" data-reveal>
      <div className="rh-card__head">
        <span className="rh-code">{spec.code}</span>
        <div className="rh-card__titles">
          <h2 className="rh-card__title">{spec.title}</h2>
          <p className="rh-card__desc">{spec.description}</p>
        </div>
      </div>

      <p className="rh-question">«{spec.question}»</p>

      <div className="rh-card__meta">
        {spec.params === 'date' ? (
          <label className="rh-date">
            <span className="rh-date__label">Дата смены</span>
            <input
              type="date"
              className="rh-date__input"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              aria-label="Дата смены"
            />
          </label>
        ) : (
          <span className="rh-period">Период: {days} дней</span>
        )}
        <Button variant="primary" size="sm" loading={running} onClick={() => void run()}>
          Сформировать
        </Button>
      </div>

      {running && (
        <p className="rh-status" role="status">
          <span className="rh-spinner" aria-hidden="true" />
          Считаем отчёт: цифры по базе и вывод модели, до 30 секунд.
        </p>
      )}

      {state !== null && !running && (
        <>
          <ReportResult spec={spec} state={state} onCsv={() => openCsv(spec, state)} />
          {state.kind === 'error' && (
            <div className="rh-retry">
              <Button variant="secondary" size="sm" onClick={() => void run()}>
                Повторить
              </Button>
            </div>
          )}
        </>
      )}
    </article>
  );
}

export function ReportsPage({ api, trackAction }: WebPageProps): JSX.Element {
  const [days, setDays] = useState(30);

  return (
    <div className="rh-page">
      <div className="rh-head" data-reveal>
        <div className="rh-head__titles">
          <h1 className="ugra-page-title rh-title">Отчёты</h1>
          <p className="rh-sub">
            Семь отчётов по обращениям. Цифры считает код, ИИ только формулирует «что это значит» и
            «что сделать». У каждого отчёта — таблица и выгрузка CSV.
          </p>
        </div>

        <div className="rh-periods ugra-liquid" role="group" aria-label="Период отчётов">
          {PERIODS.map((period) => {
            const active = days === period;
            return (
              <button
                key={period}
                type="button"
                className={active ? 'rh-period-btn rh-period-btn--on' : 'rh-period-btn'}
                aria-pressed={active}
                onClick={() => {
                  trackAction?.('select');
                  setDays(period);
                }}
              >
                {period} дней
              </button>
            );
          })}
        </div>
      </div>

      <div className="rh-grid">
        {REPORTS.map((spec) => (
          <ReportCard
            key={spec.id}
            spec={spec}
            days={days}
            api={api}
            trackAction={trackAction}
          />
        ))}
      </div>

      <p className="rh-source">
        Данные — синтетическая история за 6 месяцев. Отчёт О8 «Прогноз нагрузки» в хаб не входит:
        серверного модуля для него пока нет.
      </p>
    </div>
  );
}
