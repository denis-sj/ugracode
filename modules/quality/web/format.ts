import type { FieldDef } from '@ugra/contracts';
import type { QualityCase, QualityMetric, QualityReport } from '../contracts';

/**
 * Чистые функции экрана «Качество ИИ»: таблица «эталон / ИИ», состояния клеток
 * и сводка с порогами. Ни React, ни DOM, ни запросов — поэтому проверяются тестами.
 */

export type CellState = 'ok' | 'fail' | 'none';
export type ThresholdState = 'met' | 'unmet' | 'none';
export type ColumnKey =
  'fields' | 'invented' | 'priority' | 'emergency' | 'assignee' | 'article' | 'question';

export interface ColumnDef {
  key: ColumnKey;
  label: string;
  /** Подпись для заголовка клетки: что именно проверяли. */
  hint: string;
}

export interface CaseCell {
  key: ColumnKey;
  label: string;
  state: CellState;
  mark: string;
  hint: string;
}

export interface CaseRow {
  id: string;
  title: string;
  cells: CaseCell[];
  details: string[];
  steps: number;
}

export interface MetricRow {
  key: string;
  title: string;
  display: string;
  threshold: string;
  state: ThresholdState;
  note?: string;
}

/** Семь колонок утверждённого экрана: поля, выдуманные, приоритет, авария, исполнитель, статья, вопрос. */
export const QUALITY_COLUMNS: readonly ColumnDef[] = [
  { key: 'fields', label: 'Поля', hint: 'Совпало с эталоном' },
  { key: 'invented', label: 'Выдуманные', hint: 'Поля, которых нет в эталоне' },
  { key: 'priority', label: 'Приоритет', hint: 'Уровень приоритета' },
  { key: 'emergency', label: 'Авария', hint: 'Распознана или пропущена' },
  { key: 'assignee', label: 'Исполнитель', hint: 'Попал в топ-1' },
  { key: 'article', label: 'Статья', hint: 'Нужная статья в топ-3' },
  { key: 'question', label: 'Вопрос', hint: 'Спрошено нужное поле' },
];

export const CELL_MARK: Readonly<Record<CellState, string>> = {
  ok: '✓',
  fail: '✕',
  none: '?',
};

function boolState(value: boolean | null | undefined): CellState {
  if (value === true) return 'ok';
  if (value === false) return 'fail';
  return 'none';
}

function fieldScore(item: QualityCase): QualityCase['fields'] {
  const fields = item.fields;
  if (!fields || typeof fields !== 'object') return { correct: 0, total: 0, invented: 0 };
  return {
    correct: safeCount(fields.correct),
    total: safeCount(fields.total),
    invented: safeCount(fields.invented),
  };
}

function safeCount(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

/** Состояние одной клетки: ✓ верно, ✕ ошибка, ? нет эталона (не «всё хорошо»). */
export function cellState(item: QualityCase | null | undefined, key: ColumnKey): CellState {
  if (!item) return 'none';
  const fields = fieldScore(item);
  switch (key) {
    case 'fields':
      if (fields.total === 0) return 'none';
      return fields.correct >= fields.total && fields.invented === 0 ? 'ok' : 'fail';
    case 'invented':
      if (fields.total === 0 && fields.invented === 0) return 'none';
      return fields.invented === 0 ? 'ok' : 'fail';
    case 'emergency': {
      const value = item.emergency;
      if (value === 'ok') return 'ok';
      if (value === 'miss' || value === 'false') return 'fail';
      return 'none';
    }
    case 'assignee':
      if (item.assigneeTop1 === true || item.assigneeTop3 === true) return 'ok';
      if (item.assigneeTop1 === false || item.assigneeTop3 === false) return 'fail';
      return 'none';
    case 'priority':
    case 'article':
    case 'question':
      return boolState(item[key]);
    default:
      return 'none';
  }
}

function cellHint(item: QualityCase, key: ColumnKey): string {
  const fields = fieldScore(item);
  switch (key) {
    case 'fields':
      if (fields.total === 0) return 'в наборе нет эталона полей';
      return `верно ${fields.correct} из ${fields.total}`;
    case 'invented':
      if (fields.invented > 0) return `выдуманных полей: ${fields.invented}`;
      return fields.total === 0 ? 'полей не проверяли' : 'выдуманных нет';
    case 'priority':
      return stateHint(item.priority, 'приоритет совпал', 'приоритет не совпал');
    case 'emergency':
      if (item.emergency === 'miss') return 'пропуск аварии';
      if (item.emergency === 'false') return 'ложная тревога';
      if (item.emergency === 'ok') return 'авария распознана';
      return 'в наборе нет эталона';
    case 'assignee':
      if (item.assigneeTop1 === true) return 'исполнитель в топ-1';
      if (item.assigneeTop3 === true) return 'исполнитель в топ-3';
      if (item.assigneeTop1 === false || item.assigneeTop3 === false) return 'исполнителя нет в топ-3';
      return 'в наборе нет эталона';
    case 'article':
      return stateHint(item.article, 'статья в топ-3', 'нужной статьи нет в топ-3');
    case 'question':
      return stateHint(item.question, 'спрошено нужное поле', 'спрошено другое поле');
    default:
      return '';
  }
}

function stateHint(value: boolean | null, ok: string, fail: string): string {
  if (value === true) return ok;
  if (value === false) return fail;
  return 'в наборе нет эталона';
}

/** Одно обращение → строка таблицы с семью клетками. Битые данные не роняют экран. */
export function caseRows(cases: readonly QualityCase[] | null | undefined): CaseRow[] {
  if (!Array.isArray(cases)) return [];
  return cases.filter(isCaseLike).map((item) => ({
    id: typeof item.id === 'string' && item.id.trim() !== '' ? item.id : '—',
    title: typeof item.title === 'string' && item.title.trim() !== '' ? item.title : 'Без названия',
    cells: QUALITY_COLUMNS.map((column) => {
      const state = cellState(item, column.key);
      return {
        key: column.key,
        label: column.label,
        state,
        mark: CELL_MARK[state],
        hint: cellHint(item, column.key),
      };
    }),
    details: Array.isArray(item.details)
      ? item.details.filter((line): line is string => typeof line === 'string' && line.trim() !== '')
      : [],
    steps: safeCount(item.steps),
  }));
}

function isCaseLike(item: unknown): item is QualityCase {
  return typeof item === 'object' && item !== null;
}

/** Оценщики сводки → строки с готовым состоянием порога. */
export function metricRows(metrics: readonly QualityMetric[] | null | undefined): MetricRow[] {
  if (!Array.isArray(metrics)) return [];
  return metrics.filter(isMetricLike).map((metric, index) => ({
    key: typeof metric.key === 'string' && metric.key !== '' ? metric.key : `metric-${index + 1}`,
    title: typeof metric.title === 'string' && metric.title !== '' ? metric.title : 'Оценщик',
    display: typeof metric.display === 'string' && metric.display !== '' ? metric.display : '—',
    threshold: typeof metric.threshold === 'string' && metric.threshold !== '' ? metric.threshold : '—',
    state: thresholdState(metric),
    ...(typeof metric.note === 'string' && metric.note !== '' ? { note: metric.note } : {}),
  }));
}

function isMetricLike(item: unknown): item is QualityMetric {
  return typeof item === 'object' && item !== null;
}

/** Порог выполнен / не выполнен / не проверялся (нет эталона — не «выполнен»). */
export function thresholdState(
  metric: Pick<QualityMetric, 'passed' | 'total'> | null | undefined,
): ThresholdState {
  if (!metric) return 'none';
  if (safeCount(metric.total) === 0) return 'none';
  return metric.passed === true ? 'met' : 'unmet';
}

function plural(count: number, one: string, few: string, many: string): string {
  const value = Math.abs(count);
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** Подпись сводки: «10 обращений · выполнено 7 из 11 порогов». */
export function summaryText(report: QualityReport | null | undefined): string {
  if (!report || report.empty) return 'Отчёта ещё нет — нажмите «Прогнать набор».';
  const cases = safeCount(report.summary?.cases ?? report.cases?.length ?? 0);
  const met = safeCount(report.summary?.met);
  const total = safeCount(report.summary?.withThreshold);
  const head = `${cases} ${plural(cases, 'обращение', 'обращения', 'обращений')}`;
  if (total === 0) return `${head}: пороги не заданы`;
  return `${head} · выполнено ${met} из ${total} порогов`;
}

/** Пара «верно из проверенных»: знаменатель — только обращения с эталоном. */
export interface CountPair {
  correct: number;
  total: number;
}

/** Частое поле ошибки из строк разбора: сколько замечаний и в скольких обращениях. */
export interface TypicalFailure {
  key: string;
  label: string;
  mentions: number;
  cases: number;
  invented: number;
}

/** Цифры шапки экрана: процент полей, исполнитель, аварии и приоритет, типичная ошибка. */
export interface QualityHero {
  fieldsPercent: number | null;
  fieldsPassed: boolean;
  assignee: CountPair | null;
  incidents: CountPair | null;
  typical: TypicalFailure | null;
}

/** Итог одной колонки сетки: сколько верных из проверенных обращений. */
export interface ColumnTotal {
  key: ColumnKey;
  ok: number;
  total: number;
}

/** Процент полей из оценщика `fields`. Нет эталона — null, а не «ноль процентов». */
export function fieldsPercent(metric: QualityMetric | null | undefined): number | null {
  if (!metric || safeCount(metric.total) === 0) return null;
  const match = /(\d{1,3})\s*%/.exec(metric.display);
  if (match) {
    const parsed = Number(match[1]);
    return Number.isFinite(parsed) ? Math.min(100, parsed) : null;
  }
  if (Number.isFinite(metric.value) && metric.value >= 0 && metric.value <= 1) {
    return Math.round(metric.value * 100);
  }
  return null;
}

function assigneePair(cases: readonly QualityCase[]): CountPair | null {
  const evaluated = cases.filter((item) => item.assigneeTop1 !== null);
  if (evaluated.length === 0) return null;
  return { correct: evaluated.filter((item) => item.assigneeTop1 === true).length, total: evaluated.length };
}

function incidentsPair(cases: readonly QualityCase[]): CountPair | null {
  const evaluated = cases.filter((item) => item.priority !== null || item.emergency !== null);
  if (evaluated.length === 0) return null;
  const correct = evaluated.filter(
    (item) => item.priority !== false && item.emergency !== 'miss' && item.emergency !== 'false',
  ).length;
  return { correct, total: evaluated.length };
}

const DETAIL_FIELD = /^(поля|выдуманное поле) · ([A-Za-z0-9_]+)/;

/** Типичная ошибка — самое частое поле в строках разбора отчёта; нет строк — null. */
export function typicalFailure(
  cases: readonly QualityCase[],
  labels: ReadonlyMap<string, string> = new Map(),
): TypicalFailure | null {
  const counts = new Map<string, { mentions: number; cases: Set<string>; invented: number }>();
  for (const item of cases) {
    for (const line of item.details ?? []) {
      const match = DETAIL_FIELD.exec(line.trim());
      const key = match?.[2] ?? '';
      if (key === '') continue;
      const entry = counts.get(key) ?? { mentions: 0, cases: new Set<string>(), invented: 0 };
      entry.mentions += 1;
      entry.cases.add(item.id);
      if (match?.[1] === 'выдуманное поле') entry.invented += 1;
      counts.set(key, entry);
    }
  }
  let best: { key: string; entry: { mentions: number; cases: Set<string>; invented: number } } | null = null;
  for (const [key, entry] of counts) {
    if (best === null || entry.mentions > best.entry.mentions) {
      best = { key, entry };
      continue;
    }
    if (entry.mentions === best.entry.mentions && entry.invented > best.entry.invented) {
      best = { key, entry };
    }
  }
  if (best === null) return null;
  return {
    key: best.key,
    label: labels.get(best.key) ?? best.key,
    mentions: best.entry.mentions,
    cases: best.entry.cases.size,
    invented: best.entry.invented,
  };
}

/** Все цифры шапки из одного отчёта: ничего не выдумываем, пустое — null. */
export function qualityHero(
  report: QualityReport | null | undefined,
  fields: readonly Pick<FieldDef, 'key' | 'label'>[] = [],
): QualityHero {
  const cases = Array.isArray(report?.cases) ? report.cases : [];
  const metrics = Array.isArray(report?.summary?.metrics) ? report.summary.metrics : [];
  const fieldsMetric = metrics.find((metric) => metric.key === 'fields') ?? null;
  const percent = fieldsPercent(fieldsMetric);
  const labels = new Map(fields.map((field) => [field.key, field.label]));
  return {
    fieldsPercent: percent,
    fieldsPassed: fieldsMetric?.passed === true,
    assignee: assigneePair(cases),
    incidents: incidentsPair(cases),
    typical: typicalFailure(cases, labels),
  };
}

/** Итог колонки: верные клетки из проверенных; `?` в знаменатель не входит. */
export function columnTotals(rows: readonly CaseRow[]): ColumnTotal[] {
  return QUALITY_COLUMNS.map((column) => {
    let ok = 0;
    let total = 0;
    for (const row of rows) {
      const cell = row.cells.find((entry) => entry.key === column.key);
      if (!cell || cell.state === 'none') continue;
      total += 1;
      if (cell.state === 'ok') ok += 1;
    }
    return { key: column.key, ok, total };
  });
}

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/** «14 ноя, 16:20» для шапки; мусор и пустое — null. */
export function runTimeLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const month = MONTHS[date.getMonth()] ?? '';
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${date.getDate()} ${month}, ${hours}:${minutes}`;
}

/* ---------- Наглядный вид: балл, карточки метрик, полосы с порогом ---------- */

/** Что метрика значит — одной фразой для руководителя. */
export const METRIC_EXPLAIN: Readonly<Record<string, string>> = {
  fields: 'Поля заявки совпали с эталоном',
  fabricated: 'Значения, которых нет в обращении',
  emergency: 'Аварии, которые ИИ пропустил',
  priority: 'Приоритет совпал с эталоном',
  assigneeTop1: 'Лучший кандидат — тот самый инженер',
  assigneeTop3: 'Нужный инженер среди трёх предложенных',
  article: 'Нужная статья базы знаний в топ-3',
  question: 'ИИ спросил то, чего не хватало',
  trajectory: 'Агент вызвал нужные инструменты',
  time: 'Сколько ИИ разбирает одно обращение',
  price: 'Сколько стоит разбор одного обращения',
};

/** Главные метрики — крупно сверху; остальные — компактно. */
export const KEY_METRICS: readonly string[] = ['fields', 'emergency', 'assigneeTop3', 'fabricated'];

export interface MetricView extends MetricRow {
  explain: string;
  /** Доля 0…100 для полосы; `null` — метрика не процентная. */
  percent: number | null;
  /** Где на полосе стоит порог, 0…100. */
  thresholdAt: number | null;
}

/** «84 %» → 84; «14,8 с» → null (не процент). */
export function percentOf(display: string): number | null {
  const match = /^(\d+(?:[.,]\d+)?)\s*%$/.exec(display.trim());
  if (!match?.[1]) return null;
  return Math.max(0, Math.min(100, Number(match[1].replace(',', '.'))));
}

/** «≥ 90 %» → 90 для полосы; не процентный порог — null. */
export function thresholdPercent(threshold: string): number | null {
  const match = /(\d+(?:[.,]\d+)?)\s*%/.exec(threshold);
  return match?.[1] ? Number(match[1].replace(',', '.')) : null;
}

export function metricViews(metrics: readonly MetricRow[]): MetricView[] {
  return metrics.map((metric) => ({
    ...metric,
    explain: METRIC_EXPLAIN[metric.key] ?? metric.title,
    percent: percentOf(metric.display),
    thresholdAt: thresholdPercent(metric.threshold),
  }));
}

export interface QualityScore {
  met: number;
  total: number;
  /** 0…100 для кольца. */
  percent: number;
  verdict: string;
  /** Что не дотягивает: «Поля 84 % (нужно ≥ 90 %)». */
  gaps: string[];
  /** Чего нет в наборе — не проверяли. */
  unchecked: string[];
}

/** Общий балл экрана: сколько порогов пройдено и что подтянуть. */
export function qualityScore(report: QualityReport | null | undefined, metrics: readonly MetricRow[]): QualityScore {
  const met = safeCount(report?.summary?.met);
  const total = safeCount(report?.summary?.withThreshold);
  const checked = metrics.filter((metric) => metric.state !== 'none');
  const passed = checked.filter((metric) => metric.state === 'met').length;
  const percent = checked.length === 0 ? 0 : Math.round((passed / checked.length) * 100);
  let verdict = 'Проверок с эталоном пока нет';
  if (checked.length > 0) {
    if (passed === checked.length) verdict = 'ИИ проходит все проверки качества';
    else if (percent >= 70) verdict = 'ИИ проходит большую часть проверок';
    else verdict = 'ИИ требует настройки';
  }
  return {
    met: checked.length > 0 ? passed : met,
    total: checked.length > 0 ? checked.length : total,
    percent,
    verdict,
    gaps: metrics
      .filter((metric) => metric.state === 'unmet')
      .map((metric) => `${metric.title} ${metric.display} (нужно ${metric.threshold})`),
    unchecked: metrics.filter((metric) => metric.state === 'none').map((metric) => metric.title),
  };
}
