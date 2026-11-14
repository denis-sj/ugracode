import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import type { EvalRun } from './run';

/**
 * История настройки (раздел 5.4 харнесса): строка на прогон `pnpm eval`.
 *
 * Здесь только чистые функции: прогон → строка, строки → markdown и обратно.
 * Файл `reports/quality-history.md` читает и пишет `scripts/eval.ts`, поэтому
 * рендер и разбор проверяются тестами без файлов и без модели.
 */

/** Путь к промпту агента `intake` — по его содержимому считается версия. */
export const PROMPT_FILE = 'modules/extraction/prompts/intake.v1.md';

/** 11 оценщиков из раздела 5.2 в порядке таблицы отчёта. */
export const HISTORY_METRICS: readonly { key: string; title: string }[] = [
  { key: 'fields', title: 'Поля' },
  { key: 'fabricated', title: 'Выдум.' },
  { key: 'emergency', title: 'Авария' },
  { key: 'priority', title: 'Приоритет' },
  { key: 'assigneeTop1', title: 'Топ-1' },
  { key: 'assigneeTop3', title: 'Топ-3' },
  { key: 'article', title: 'Статья' },
  { key: 'question', title: 'Вопрос' },
  { key: 'trajectory', title: 'Траектория' },
  { key: 'time', title: 'Время' },
  { key: 'price', title: 'Цена' },
];

/** Сколько колонок в строке: дата, модель, промпт, набор + оценки + «порогов». */
export const COLUMNS = 4 + HISTORY_METRICS.length + 1;

const SEPARATOR = /^:?-{2,}:?$/;
const THRESHOLD_CELL = /^(\d+)\s+из\s+(\d+)$/;

/** Один прогон в истории. Все поля — то, что видно в таблице (разбор строки обратим). */
export interface HistoryRow {
  /** `run.startedAt`, ISO 8601: по нему видно, какой прогон новее. */
  date: string;
  /** `stub` или id модели. */
  model: string;
  /** Версия промпта: первые 8 символов sha256 (`promptVersion`). */
  prompt: string;
  /** Набор и число обращений: `cases (10)`. */
  set: string;
  /** 11 значений оценщиков в порядке `HISTORY_METRICS`. */
  metrics: string[];
  /** Сколько порогов выполнено. */
  met: number;
  /** Сколько оценщиков с порогом было в прогоне. */
  withThreshold: number;
}

export interface HistoryOptions {
  /** Версия промпта; без неё берётся поле прогона или «—». */
  prompt?: string;
}

/** Первые 8 символов sha256 от текста файла промпта. */
export function promptVersion(content: string, length = 8): string {
  return createHash('sha256').update(content, 'utf8').digest('hex').slice(0, length);
}

function promptOfRun(run: EvalRun): string | null {
  const value = (run as EvalRun & { promptVersion?: unknown }).promptVersion;
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** Прогон → строка истории: дата, модель, версия промпта, набор, 11 оценщиков, пороги. */
export function historyRow(run: EvalRun, options: HistoryOptions = {}): HistoryRow {
  const displays = new Map(run.summary.evaluators.map((item) => [item.key, item.display]));
  const prompt = options.prompt?.trim() || promptOfRun(run) || '—';
  const set = basename(run.dirs.casesDir) || 'набор';
  return {
    date: run.startedAt,
    model: run.model,
    prompt,
    set: `${set} (${run.summary.cases})`,
    metrics: HISTORY_METRICS.map((metric) => displays.get(metric.key) ?? '—'),
    met: run.summary.met,
    withThreshold: run.summary.withThreshold,
  };
}

/** Ключ дубля: один и тот же прогон не должен появиться в истории дважды. */
function rowKey(row: HistoryRow): string {
  return [row.date, row.model, row.prompt].join('␟');
}

function cell(value: string): string {
  return value.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
}

function rowLine(row: HistoryRow): string {
  const cells = [
    row.date,
    row.model,
    row.prompt,
    row.set,
    ...row.metrics,
    `${row.met} из ${row.withThreshold}`,
  ];
  return `| ${cells.map(cell).join(' | ')} |`;
}

/** История в markdown: новые прогоны сверху. Пустой список — таблица с заголовком. */
export function renderHistory(rows: readonly HistoryRow[]): string {
  const header = ['Дата', 'Модель', 'Промпт', 'Набор', ...HISTORY_METRICS.map((item) => item.title), 'Порогов'];
  const lines = [
    '# История прогонов качества',
    '',
    'Строка — один прогон `pnpm eval`: дата, модель, версия промпта, набор и 11 оценщиков.',
    'Новые сверху; повторный прогон с теми же датой, моделью и версией промпта не дублируется.',
    'Ответы и траектории — в `reports/eval-<дата>.json`, последний полный отчёт — `reports/quality.md`.',
    '',
    `| ${header.join(' | ')} |`,
    `|${header.map(() => '---').join('|')}|`,
    ...rows.map(rowLine),
  ];
  const newest = rows[0];
  if (newest) {
    lines.push('', `Порогов в последнем прогоне: ${newest.met} из ${newest.withThreshold}.`);
  } else {
    lines.push('', 'Прогонов пока нет: сделайте `pnpm eval`.');
  }
  lines.push('');
  return lines.join('\n');
}

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split(/(?<!\\)\|/).map((value) => value.replace(/\\\|/g, '|').trim());
}

/**
 * Обратное чтение истории. Всё, что не похоже на строку таблицы (заголовок,
 * разделитель, битые и недописанные строки), пропускается — файл не роняет прогон.
 */
export function parseHistory(markdown: string): HistoryRow[] {
  const rows: HistoryRow[] = [];
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith('|')) continue;
    const cells = splitRow(line);
    if (cells.length !== COLUMNS) continue;
    if (cells[0] === 'Дата' || cells.every((value) => SEPARATOR.test(value))) continue;
    const met = cells[COLUMNS - 1] ?? '';
    const threshold = THRESHOLD_CELL.exec(met);
    if (!threshold) continue;
    const date = cells[0] ?? '';
    const model = cells[1] ?? '';
    const prompt = cells[2] ?? '';
    const set = cells[3] ?? '';
    if (date === '' || model === '') continue;
    rows.push({
      date,
      model,
      prompt,
      set,
      metrics: cells.slice(4, 4 + HISTORY_METRICS.length),
      met: Number(threshold[1]),
      withThreshold: Number(threshold[2]),
    });
  }
  return rows;
}

/** Дописать строку: старые прогоны сохраняются, совпадение по дате+модель+версии заменяется. */
export function appendHistory(existing: string, row: HistoryRow): string {
  const key = rowKey(row);
  const rows = [row, ...parseHistory(existing).filter((item) => rowKey(item) !== key)];
  return renderHistory(rows);
}
