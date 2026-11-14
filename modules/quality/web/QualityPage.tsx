import './quality.css';
import type { JSX, RefObject } from 'react';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Card, EmptyState, formatDateTime, useListMotion } from '@ugra/ui';
import type { WebPageProps } from '@ugra/ui';
import type { QualityReport } from '../contracts';
import { loadQualityReport, runQualityEval } from './api';
import { QUALITY_COLUMNS, caseRows, metricRows, summaryText } from './format';
import type { CaseRow, MetricRow, ThresholdState } from './format';

/** Экран 14 «Качество ИИ» (К2): прогон набора и таблица «эталон / ИИ». */

const RUN_HINT = 'Гоняем 10 обращений через движок в режиме заглушки: до 60 секунд.';

const METRIC_TONE: Readonly<Record<ThresholdState, 'ok' | 'danger' | 'muted'>> = {
  met: 'ok',
  unmet: 'danger',
  none: 'muted',
};

const METRIC_LABEL: Readonly<Record<ThresholdState, string>> = {
  met: 'порог выполнен',
  unmet: 'порог не выполнен',
  none: 'нет эталона',
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function detailId(id: string): string {
  return `qlt-detail-${id.replace(/[^\w-]/g, '-')}`;
}

function MetricCell({ metric }: { metric: MetricRow }): JSX.Element {
  return (
    <div className={`qlt-metric qlt-metric--${metric.state}`}>
      <span className="qlt-metric__title">{metric.title}</span>
      <span className="qlt-metric__value">{metric.display}</span>
      <span className="qlt-metric__threshold">порог {metric.threshold}</span>
      <Badge tone={METRIC_TONE[metric.state]}>{METRIC_LABEL[metric.state]}</Badge>
      {metric.note && <span className="qlt-metric__note">{metric.note}</span>}
    </div>
  );
}

function CaseDetails({ row }: { row: CaseRow }): JSX.Element {
  return (
    <div className="qlt-details__body">
      <div className="qlt-details__facts">
        <span>
          Обращение: <b>{row.id}</b>
        </span>
        <span>
          Шагов агента: <b>{row.steps}</b>
        </span>
      </div>
      {row.details.length === 0 ? (
        <p className="qlt-details__empty">
          Ошибок по оценщикам нет: все проверяемые поля совпали с эталоном.
        </p>
      ) : (
        <ul className="qlt-details__list">
          {row.details.map((line, index) => (
            <li key={`${row.id}-${index}`}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function QualityTable({
  rows,
  expanded,
  onToggle,
  tbodyRef,
}: {
  rows: CaseRow[];
  expanded: string | null;
  onToggle: (id: string) => void;
  tbodyRef: RefObject<HTMLTableSectionElement | null>;
}): JSX.Element {
  return (
    <Card padded={false} className="qlt-table-card">
      <div className="qlt-table-head">
        <div>
          <h2 className="qlt-section-title">Разбор по обращениям</h2>
          <p className="qlt-table-hint">Клик по строке — эталон, ответ ИИ и выдуманные поля.</p>
        </div>
        <span className="qlt-table-count">обращений: {rows.length}</span>
      </div>
      <div className="qlt-table-scroll">
        <table className="qlt-table">
          <thead>
            <tr>
              <th className="qlt-col-name" scope="col">
                Обращение
              </th>
              {QUALITY_COLUMNS.map((column) => (
                <th key={column.key} className="qlt-col-cell" scope="col" title={column.hint}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody ref={tbodyRef}>
            {rows.map((row) => {
              const open = expanded === row.id;
              const id = detailId(row.id);
              return (
                <Fragment key={row.id}>
                  <tr
                    className={open ? 'qlt-row qlt-row--open' : 'qlt-row'}
                    tabIndex={0}
                    onClick={() => onToggle(row.id)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      onToggle(row.id);
                    }}
                  >
                    <td className="qlt-row__name">
                      <button
                        type="button"
                        className="qlt-row__toggle"
                        aria-expanded={open}
                        aria-controls={id}
                        onClick={(event) => {
                          event.stopPropagation();
                          onToggle(row.id);
                        }}
                      >
                        <span aria-hidden="true">{open ? '▾' : '▸'}</span>
                      </button>
                      <span className="qlt-row__title" title={row.title}>
                        {row.title}
                      </span>
                      {row.title !== row.id && <span className="qlt-row__id">{row.id}</span>}
                    </td>
                    {row.cells.map((cell) => (
                      <td key={cell.key} className="qlt-row__cell">
                        <span
                          className={`qlt-cell qlt-cell--${cell.state}`}
                          title={cell.hint}
                          aria-label={`${cell.label}: ${cell.hint}`}
                        >
                          {cell.mark}
                        </span>
                      </td>
                    ))}
                  </tr>
                  {open && (
                    <tr className="qlt-details" id={id}>
                      <td colSpan={QUALITY_COLUMNS.length + 1}>
                        <CaseDetails row={row} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="qlt-legend">
        ✓ совпало с эталоном · ✕ ошибка · ? ИИ честно не нашёл или эталона в наборе нет
      </p>
    </Card>
  );
}

export function QualityPage({ api, trackAction }: WebPageProps): JSX.Element {
  const [report, setReport] = useState<QualityReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const tbodyRef = useRef<HTMLTableSectionElement | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      setReport(await loadQualityReport(api));
    } catch (error) {
      setLoadError(errorText(error));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (): Promise<void> => {
    if (running) return;
    setRunning(true);
    setRunError(null);
    trackAction?.('click');
    try {
      setReport(await runQualityEval(api));
      setExpanded(null);
    } catch (error) {
      setRunError(errorText(error));
    } finally {
      setRunning(false);
    }
  };

  const rows = useMemo(() => caseRows(report?.cases), [report]);
  const metrics = useMemo(() => metricRows(report?.summary?.metrics), [report]);
  const hasReport = report !== null && !report.empty;
  useListMotion(tbodyRef, rows.length > 0);

  const toggle = (id: string): void => {
    trackAction?.('select');
    setExpanded((current) => (current === id ? null : id));
  };

  const runLabel = running ? 'Идёт прогон…' : hasReport ? 'Прогнать набор заново' : 'Прогнать набор';

  return (
    <div className="qlt-page">
      <div className="qlt-head" data-reveal>
        <div className="qlt-head__titles">
          <h1 className="ugra-page-title qlt-title">Качество ИИ</h1>
          <p className="qlt-sub">
            Тестовый набор: 10 обращений с эталонной разметкой. Сравниваем ответ ИИ с эталоном по каждому
            полю.
          </p>
        </div>
        <div className="qlt-actions">
          <Button variant="primary" size="lg" loading={running} onClick={() => void run()}>
            {runLabel}
          </Button>
        </div>
      </div>

      {running && (
        <p className="qlt-status" role="status">
          <span className="qlt-spinner" aria-hidden="true" />
          {RUN_HINT}
        </p>
      )}

      {runError && (
        <Card tone="danger" className="qlt-error-card">
          <div className="qlt-error">
            <div>
              <b>Не удалось прогнать набор</b>
              <p role="alert">{runError}</p>
            </div>
            <Button variant="secondary" onClick={() => void run()}>
              Повторить
            </Button>
          </div>
        </Card>
      )}

      {loadError && (
        <Card tone="danger" className="qlt-error-card">
          <div className="qlt-error">
            <div>
              <b>Не удалось загрузить отчёт</b>
              <p role="alert">{loadError}</p>
            </div>
            <Button variant="secondary" onClick={() => void load()}>
              Повторить
            </Button>
          </div>
        </Card>
      )}

      {loading && (
        <Card className="qlt-loading">
          <span className="qlt-spinner" aria-hidden="true" />
          Загружаем последний отчёт…
        </Card>
      )}

      {!loading && !loadError && (report === null || report.empty) && (
        <EmptyState
          icon="◎"
          title="Набора ещё не прогоняли"
          hint="Нажмите, чтобы прогнать: 10 обращений, режим заглушки, без сети и ключей модели."
        >
          <Button variant="primary" onClick={() => void run()}>
            Прогнать набор
          </Button>
        </EmptyState>
      )}

      {!loading && hasReport && report && (
        <>
          <Card className="qlt-summary">
            <div className="qlt-summary__head">
              <div>
                <h2 className="qlt-section-title">Сводка с порогами</h2>
                <p className="qlt-summary__text">{summaryText(report)}</p>
              </div>
              <div className="qlt-summary__meta">
                {report.startedAt && <span>{formatDateTime(report.startedAt)}</span>}
                {report.model && <span>{report.model}</span>}
                {report.duration && <span>{report.duration}</span>}
                {report.set && <span>набор {report.set}</span>}
              </div>
            </div>
            <div className="qlt-metrics">
              {metrics.map((metric) => (
                <MetricCell key={metric.key} metric={metric} />
              ))}
            </div>
            <p className="qlt-caveat">
              Набор — 10 обращений, синтетика: цифры могут быть завышены и не заменяют настройку на большом
              наборе. Без эталона оценщик показывает «—»: это «не проверяли», а не «всё хорошо».
            </p>
            {report.notes.length > 0 && (
              <details className="qlt-notes">
                <summary>Оговорки отчёта</summary>
                <ul>
                  {report.notes.map((note, index) => (
                    <li key={`${index}-${note.slice(0, 24)}`}>{note}</li>
                  ))}
                </ul>
              </details>
            )}
          </Card>

          <QualityTable rows={rows} expanded={expanded} onToggle={toggle} tbodyRef={tbodyRef} />
        </>
      )}
    </div>
  );
}
