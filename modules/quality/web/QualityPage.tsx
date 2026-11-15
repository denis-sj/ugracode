import './quality.css';
import type { JSX, RefObject } from 'react';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, EmptyState, celebrate, formatDateTime, useListMotion } from '@ugra/ui';
import type { WebPageProps } from '@ugra/ui';
import type { QualityReport } from '../contracts';
import { loadQualityReport, runQualityEval } from './api';
import { KEY_METRICS, QUALITY_COLUMNS, caseRows, metricRows, metricViews, qualityScore } from './format';
import type { CaseRow } from './format';
import { MetricCard, RunScanner, ScoreRing, caseVerdict } from './QualityVisual';
import type { ScanState } from './QualityVisual';

/** Экран 14 «Качество ИИ» (К2): прогон набора и таблица «эталон / ИИ». */

/** Шаг «живого» показа прогона: обращения проверяются по очереди, результат — из ответа сервера. */
const SCAN_STEP_MS = 320;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function detailId(id: string): string {
  return `qlt-detail-${id.replace(/[^\w-]/g, '-')}`;
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
  const [scanTitles, setScanTitles] = useState<{ id: string; title: string }[]>([]);
  const [scanStates, setScanStates] = useState<ScanState[]>([]);
  const [scanDone, setScanDone] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const heroRef = useRef<HTMLDivElement | null>(null);
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
    const titles = caseRows(report?.cases).map((row) => ({ id: row.id, title: row.title }));
    const list = titles.length > 0 ? titles : Array.from({ length: 10 }, (_v, index) => ({ id: `case-${index + 1}`, title: `Обращение ${index + 1}` }));
    setScanTitles(list);
    setScanStates(list.map(() => 'wait'));
    setScanDone(0);
    setRunning(true);
    setRunError(null);
    trackAction?.('click');
    // Пока сервер гоняет набор, бегунок идёт по обращениям; ответ не придёт раньше — ждём на последнем.
    let cursor = 0;
    const timer = window.setInterval(() => {
      cursor = Math.min(cursor + 1, list.length - 1);
      setScanStates((states) => states.map((state, index) => (index === cursor ? 'scan' : state)));
    }, SCAN_STEP_MS);
    setScanStates((states) => states.map((state, index) => (index === 0 ? 'scan' : state)));
    try {
      const fresh = await runQualityEval(api);
      window.clearInterval(timer);
      const freshRows = caseRows(fresh.cases);
      // Итог каждого обращения — из настоящего ответа: раскрываем по одному.
      for (let index = 0; index < list.length; index += 1) {
        const verdict = caseVerdict(freshRows.find((row) => row.id === list[index]?.id) ?? freshRows[index]);
        setScanStates((states) => states.map((state, at) => (at === index ? verdict : state)));
        setScanDone(index + 1);
        await wait(SCAN_STEP_MS / 2);
      }
      await wait(400);
      setReport(fresh);
      setExpanded(null);
      setUpdatedAt(Date.now());
      celebrate(heroRef.current);
    } catch (error) {
      window.clearInterval(timer);
      setRunError(errorText(error));
    } finally {
      setRunning(false);
    }
  };

  const rows = useMemo(() => caseRows(report?.cases), [report]);
  const metrics = useMemo(() => metricViews(metricRows(report?.summary?.metrics)), [report]);
  const score = useMemo(() => qualityScore(report, metrics), [report, metrics]);
  const keyMetrics = metrics.filter((metric) => KEY_METRICS.includes(metric.key));
  const otherMetrics = metrics.filter((metric) => !KEY_METRICS.includes(metric.key) && metric.state !== 'none');
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
            10 обращений с эталонной разметкой проходят через того же агента, что и в демо. Каждое поле
            сравнивается с эталоном.
          </p>
        </div>
      </div>

      {running && <RunScanner titles={scanTitles} states={scanStates} done={scanDone} />}

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
          <section className={updatedAt ? 'qv-hero qv-hero--fresh' : 'qv-hero'} ref={heroRef} key={updatedAt ?? 'initial'}>
            <ScoreRing score={score} />
            <div className="qv-hero__text">
              <h2 className="qv-hero__verdict">{score.verdict}</h2>
              <p className="qv-hero__meta">
                {report.cases.length} обращений
                {report.model ? ` · ${report.model}` : ''}
                {report.duration ? ` · ${report.duration}` : ''}
                {report.startedAt ? ` · ${formatDateTime(report.startedAt)}` : ''}
                {updatedAt ? ' · обновлено только что' : ''}
              </p>
              {score.gaps.length > 0 && (
                <ul className="qv-hero__gaps">
                  {score.gaps.map((gap) => (
                    <li key={gap}>{gap}</li>
                  ))}
                </ul>
              )}
            </div>
            <div className="qv-hero__action">
              <Button variant="primary" size="lg" loading={running} onClick={() => void run()}>
                {runLabel}
              </Button>
              <span className="qv-hero__hint">Набор 10 обращений · результат ниже</span>
            </div>
          </section>

          <div className="qv-grid qv-grid--key">
            {keyMetrics.map((metric, index) => (
              <MetricCard key={metric.key} metric={metric} index={index} large />
            ))}
          </div>
          <div className="qv-grid">
            {otherMetrics.map((metric, index) => (
              <MetricCard key={metric.key} metric={metric} index={index + keyMetrics.length} />
            ))}
          </div>
          {score.unchecked.length > 0 && (
            <p className="qv-unchecked">
              Не проверялось — в наборе нет эталона: {score.unchecked.join(', ')}. Это «не мерили», а не «всё хорошо».
            </p>
          )}
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

          <QualityTable rows={rows} expanded={expanded} onToggle={toggle} tbodyRef={tbodyRef} />
        </>
      )}
    </div>
  );
}
