import { basename } from 'node:path';
import { QUALITY_CASE_LIMIT } from '../contracts';
import type { QualityCase, QualityMetric, QualityReport } from '../contracts';
import type { EvaluatorSummary } from './metrics';
import { formatSeconds } from './metrics';
import { CAVEATS, failureLines } from './report';
import type { CaseRun, EvalRun } from './run';

/**
 * Отчёт для экрана «Качество ИИ» (К2).
 *
 * Два источника дают один и тот же `QualityReport`:
 * - `reports/quality.md` — последний прогон `pnpm eval`, его разбирает `parseQualityReport`;
 * - `runEval()` — свежий прогон из `POST /api/m/quality/run`, его собирает `reportFromRun`.
 *
 * Здесь только чистые функции: ни файлов, ни модели, ни сети. Поэтому разбор
 * markdown и таблица проверяются тестами без прогона.
 */

const SEPARATOR = /^:?-{2,}:?$/;
const TITLE_NOTE = /^(.*?)\s*_\((.+)\)_\s*$/;
const METRIC_KEYS: readonly { title: string; key: string }[] = [
  { title: 'Поля', key: 'fields' },
  { title: 'Выдуманные поля', key: 'fabricated' },
  { title: 'Авария: пропуски', key: 'emergency' },
  { title: 'Приоритет', key: 'priority' },
  { title: 'Исполнитель в топ-1', key: 'assigneeTop1' },
  { title: 'Исполнитель в топ-3', key: 'assigneeTop3' },
  { title: 'Статья в топ-3', key: 'article' },
  { title: 'Нужный вопрос заявителю', key: 'question' },
  { title: 'Траектория агента', key: 'trajectory' },
  { title: 'Время на обращение (медиана)', key: 'time' },
  { title: 'Цена обращения (медиана)', key: 'price' },
];

/** Отчёт, которого ещё нет: экран показывает «Нажмите, чтобы прогнать». */
export function emptyReport(): QualityReport {
  return {
    empty: true,
    startedAt: null,
    finishedAt: null,
    model: null,
    set: null,
    duration: null,
    cases: [],
    summary: { cases: 0, met: 0, withThreshold: 0, failedSteps: 0, metrics: [] },
    notes: [],
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toCount(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

/** Короткий заголовок строки: первая фраза обращения без лишних пробелов. */
function titleOf(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized === '') return 'Без текста';
  return normalized.length > 90 ? `${normalized.slice(0, 89)}…` : normalized;
}

function emergencyOf(item: CaseRun): QualityCase['emergency'] {
  const outcome = item.evaluation.emergency;
  if (!outcome) return null;
  if (outcome.miss) return 'miss';
  if (outcome.falseAlarm) return 'false';
  return 'ok';
}

function caseFromRun(item: CaseRun): QualityCase {
  const evaluation = item.evaluation;
  return {
    id: evaluation.id,
    title: titleOf(item.evalCase.text),
    fields: {
      correct: evaluation.fields.hits,
      total: evaluation.fields.total,
      invented: evaluation.fields.fabricated.length,
    },
    priority: evaluation.priority,
    emergency: emergencyOf(item),
    assigneeTop1: evaluation.assignee ? evaluation.assignee.top1 : null,
    assigneeTop3: evaluation.assignee ? evaluation.assignee.top3 : null,
    article: evaluation.article,
    question: evaluation.question,
    steps: evaluation.steps,
    details: failureLines(item),
  };
}

function metricFromSummary(item: EvaluatorSummary): QualityMetric {
  return {
    key: item.key,
    title: item.title,
    value: item.value,
    display: item.display,
    ideal: item.ideal,
    threshold: item.threshold,
    passed: item.passed,
    total: item.total,
    ...(item.note ? { note: item.note } : {}),
  };
}

function durationOf(run: EvalRun): string {
  const startedAt = new Date(run.startedAt).getTime();
  const finishedAt = new Date(run.finishedAt).getTime();
  if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt)) return '—';
  const ms = Math.max(0, finishedAt - startedAt);
  return ms < 100 ? '< 0,1 с' : formatSeconds(ms);
}

/** Свежий прогон → ответ экрана: не больше 10 обращений, те же строки, что в отчёте. */
export function reportFromRun(run: EvalRun): QualityReport {
  const cases = run.cases.slice(0, QUALITY_CASE_LIMIT).map(caseFromRun);
  const skipped = run.skipped.map((item) => `Пропущен файл набора ${item.file}: ${item.error}`);
  return {
    empty: cases.length === 0,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    model: run.model,
    set: basename(run.dirs.casesDir),
    duration: durationOf(run),
    cases,
    summary: {
      cases: cases.length,
      met: run.summary.met,
      withThreshold: run.summary.withThreshold,
      failedSteps: run.summary.failedSteps,
      metrics: run.summary.evaluators.map(metricFromSummary),
    },
    notes: [...CAVEATS.map(cleanNote), ...run.warnings, ...skipped],
  };
}

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split(/(?<!\\)\|/).map((value) => value.replace(/\\\|/g, '|').trim());
}

/** Строки markdown-таблицы; заголовок и разделитель отбрасывает, битые — тоже. */
function tableRows(lines: readonly string[], minCells: number): string[][] {
  const rows: string[][] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith('|')) continue;
    const cells = splitRow(line);
    if (cells.length < minCells) continue;
    if (cells.every((value) => SEPARATOR.test(value))) continue;
    rows.push(cells);
  }
  return rows;
}

/** Строки раздела `## <heading>` без следующего заголовка второго уровня. */
function sectionLines(markdown: string, heading: string): string[] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start < 0) return [];
  const result: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line)) break;
    result.push(line);
  }
  return result;
}

function metaOf(markdown: string): Map<string, string> {
  const head = markdown.split(/\r?\n## /)[0] ?? '';
  const meta = new Map<string, string>();
  for (const cells of tableRows(head.split(/\r?\n/), 2)) {
    const key = (cells[0] ?? '').trim();
    const value = (cells[1] ?? '').trim();
    if (key !== '' && value !== '') meta.set(key, value);
  }
  return meta;
}

function thresholdCounts(value: string | undefined): { met: number; withThreshold: number } {
  const match = /(\d+)\s+из\s+(\d+)/.exec(value ?? '');
  if (!match) return { met: 0, withThreshold: 0 };
  return { met: Number(match[1] ?? 0), withThreshold: Number(match[2] ?? 0) };
}

function metricKey(title: string, index: number): string {
  return METRIC_KEYS.find((item) => item.title === title)?.key ?? `metric-${index + 1}`;
}

function parseTitle(raw: string): { title: string; note?: string } {
  const match = TITLE_NOTE.exec(raw);
  if (!match) return { title: raw };
  const title = (match[1] ?? raw).trim();
  const note = (match[2] ?? '').trim();
  return note === '' ? { title } : { title, note };
}

function metricFromCells(cells: readonly string[], index: number): QualityMetric {
  const parsed = parseTitle((cells[0] ?? '').trim());
  const display = (cells[2] ?? '—').trim();
  return {
    key: metricKey(parsed.title, index),
    title: parsed.title,
    value: 0,
    display,
    ideal: (cells[1] ?? '—').trim(),
    threshold: (cells[3] ?? '—').trim(),
    passed: (cells[4] ?? '').includes('✅'),
    total: display === '—' ? 0 : 1,
    ...(parsed.note ? { note: parsed.note } : {}),
  };
}

function parseMetrics(markdown: string): QualityMetric[] {
  return tableRows(sectionLines(markdown, 'Таблица «эталон / ИИ»'), 5)
    .filter((cells) => (cells[0] ?? '') !== 'Оценщик')
    .map(metricFromCells);
}

function boolCell(value: string | undefined): boolean | null {
  if ((value ?? '').includes('✅')) return true;
  if ((value ?? '').includes('❌')) return false;
  return null;
}

function emergencyCell(value: string | undefined): QualityCase['emergency'] {
  const cell = value ?? '';
  if (cell.includes('пропуск')) return 'miss';
  if (cell.includes('ложн')) return 'false';
  if (cell.includes('✅')) return 'ok';
  return null;
}

function assigneeCell(value: string | undefined): Pick<QualityCase, 'assigneeTop1' | 'assigneeTop3'> {
  const cell = value ?? '';
  if (cell.includes('топ-1')) return { assigneeTop1: true, assigneeTop3: true };
  if (cell.includes('топ-3')) return { assigneeTop1: false, assigneeTop3: true };
  if (cell.includes('❌')) return { assigneeTop1: false, assigneeTop3: false };
  return { assigneeTop1: null, assigneeTop3: null };
}

function fieldsCell(value: string | undefined): QualityCase['fields'] {
  const cell = value ?? '';
  const ratio = /(\d+)\s*\/\s*(\d+)/.exec(cell);
  const invented = /\+\s*(\d+)\s*выд/.exec(cell);
  return {
    correct: ratio ? Number(ratio[1] ?? 0) : 0,
    total: ratio ? Number(ratio[2] ?? 0) : 0,
    invented: invented ? Number(invented[1] ?? 0) : 0,
  };
}

function stepCount(value: string | undefined): number {
  const parsed = Number((value ?? '').trim());
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function caseFromCells(cells: readonly string[]): QualityCase | null {
  const id = (cells[0] ?? '').trim();
  if (id === '' || id === 'Кейс') return null;
  return {
    id,
    title: id,
    fields: fieldsCell(cells[1]),
    priority: boolCell(cells[2]),
    emergency: emergencyCell(cells[3]),
    ...assigneeCell(cells[4]),
    article: boolCell(cells[5]),
    question: boolCell(cells[6]),
    steps: stepCount(cells[7]),
    details: [],
  };
}

function parseCases(markdown: string): QualityCase[] {
  return tableRows(sectionLines(markdown, 'По обращениям'), 9)
    .map(caseFromCells)
    .filter((item): item is QualityCase => item !== null);
}

/** Подробности из «### case-01» + строки «- …»; битые строки игнорируются. */
function parseDetails(markdown: string): Map<string, string[]> {
  const details = new Map<string, string[]>();
  let current: string | null = null;
  for (const raw of sectionLines(markdown, 'Провалы по оценщикам')) {
    const line = raw.trim();
    const heading = /^###\s+(.+)$/.exec(line);
    if (heading) {
      current = (heading[1] ?? '').trim();
      if (!details.has(current)) details.set(current, []);
      continue;
    }
    if (current === null || !line.startsWith('- ')) continue;
    details.get(current)?.push(line.slice(2).trim());
  }
  return details;
}

function cleanNote(text: string): string {
  return text.replace(/\*\*/g, '').replace(/`/g, '').trim();
}

function bullets(markdown: string, heading: string): string[] {
  const result: string[] = [];
  for (const raw of sectionLines(markdown, heading)) {
    const line = raw.trim();
    if (!line.startsWith('- ')) continue;
    const text = cleanNote(line.slice(2));
    if (text === '') continue;
    const previous = result[result.length - 1];
    if (previous !== undefined && previous.endsWith(':') && /^[a-zа-яё]/.test(text)) {
      result[result.length - 1] = `${previous} ${text}`;
      continue;
    }
    result.push(text);
  }
  return result;
}

function cleanModel(value: string | undefined): string | null {
  const text = (value ?? '').replace(/`/g, '').trim();
  return text === '' ? null : text;
}

/**
 * `reports/quality.md` → структура экрана. Разбор терпимый: битые строки
 * и незнакомые разделы пропускаются, файл не роняет ни страницу, ни демо.
 */
export function parseQualityReport(markdown: string): QualityReport {
  if (markdown.trim() === '') return emptyReport();
  const meta = metaOf(markdown);
  const details = parseDetails(markdown);
  const cases = parseCases(markdown).map((item) => ({
    ...item,
    details: details.get(item.id) ?? [],
  }));
  const metrics = parseMetrics(markdown);
  const thresholds = thresholdCounts(meta.get('Порогов выполнено'));
  const failedSteps = toCount(meta.get('Шагов с ошибкой'));
  return {
    empty: cases.length === 0,
    startedAt: meta.get('Прогон') ?? null,
    finishedAt: null,
    model: cleanModel(meta.get('Модель')),
    set: meta.get('Набор') ?? null,
    duration: meta.get('Длительность') ?? null,
    cases,
    summary: {
      cases: cases.length,
      met: thresholds.met,
      withThreshold: thresholds.withThreshold,
      failedSteps,
      metrics,
    },
    notes: [
      ...bullets(markdown, 'Оговорки'),
      ...bullets(markdown, 'Предупреждения прогона'),
      ...bullets(markdown, 'Пропущенные файлы набора'),
    ],
  };
}

/** Ошибка чтения файла отчёта — та же пустая страница с честной пометкой. */
export function unreadableReport(error: unknown): QualityReport {
  return {
    ...emptyReport(),
    notes: [`Не удалось прочитать reports/quality.md: ${messageOf(error)}`],
  };
}

/**
 * В `reports/quality.md` строки таблицы знают только `case-01`, а на экране нужно
 * название обращения. Тексты берём из `testset/cases/*.json`; нет файла — остаётся id.
 */
export function applyCaseTitles(report: QualityReport, titles: ReadonlyMap<string, string>): QualityReport {
  if (report.cases.length === 0 || titles.size === 0) return report;
  return {
    ...report,
    cases: report.cases.map((item) => {
      const text = titles.get(item.id);
      return text === undefined ? item : { ...item, title: titleOf(text) };
    }),
  };
}
