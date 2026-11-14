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
