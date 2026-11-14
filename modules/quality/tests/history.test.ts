import { describe, expect, it } from 'vitest';
import type { EvaluatorSummary, QualitySummary } from '../server/metrics';
import type { EvalRun } from '../server/run';
import type { HistoryRow } from '../server/history';
import {
  COLUMNS,
  HISTORY_METRICS,
  appendHistory,
  historyRow,
  parseHistory,
  promptVersion,
  renderHistory,
} from '../server/history';

function evaluators(): EvaluatorSummary[] {
  return HISTORY_METRICS.map((metric, index) => ({
    key: metric.key,
    title: metric.title,
    value: index / 10,
    display: `${metric.key} ${index}`,
    ideal: '100 %',
    threshold: '≥ 90 %',
    passed: index !== 1,
    total: 10,
  }));
}

function summaryOf(patch: Partial<QualitySummary> = {}): QualitySummary {
  return {
    cases: 10,
    evaluators: evaluators(),
    unmet: [],
    fabricatedTotal: 0,
    emergencyMisses: 0,
    emergencyFalseAlarms: 0,
    failedSteps: 0,
    medianMs: 14_800,
    medianCostRub: 0.2,
    met: 10,
    withThreshold: 11,
    ...patch,
  };
}

function runOf(patch: Partial<EvalRun> = {}): EvalRun {
  return {
    startedAt: '2026-11-14T16:07:25.365Z',
    finishedAt: '2026-11-14T16:09:52.000Z',
    mode: 'cloud',
    model: 'deepseek/deepseek-v4.1-flash-1017',
    dirs: {
      dataDir: '/repo/data',
      casesDir: '/repo/testset/cases',
      stubsDir: '/repo/testset/stubs',
    },
    cases: [],
    skipped: [],
    summary: summaryOf(),
    warnings: [],
    ...patch,
  };
}

function rowOf(patch: Partial<HistoryRow> = {}): HistoryRow {
  return {
    date: '2026-11-14T16:07:25.365Z',
    model: 'deepseek/deepseek-v4.1-flash-1017',
    prompt: '490c8558',
    set: 'cases (10)',
    metrics: HISTORY_METRICS.map((metric, index) => `${metric.key} ${index}`),
    met: 7,
    withThreshold: 11,
    ...patch,
  };
}

describe('quality: история настройки — строка прогона', () => {
  it('берёт дату, модель, набор, 11 оценщиков и пороги из прогона', () => {
    const row = historyRow(runOf(), { prompt: '490c8558' });
    expect(row.date).toBe('2026-11-14T16:07:25.365Z');
    expect(row.model).toBe('deepseek/deepseek-v4.1-flash-1017');
    expect(row.prompt).toBe('490c8558');
    expect(row.set).toBe('cases (10)');
    expect(row.metrics).toHaveLength(11);
    expect(row.metrics[0]).toBe('fields 0');
    expect(row.met).toBe(10);
    expect(row.withThreshold).toBe(11);
  });

  it('без версии промпта пишет «—», а поле прогона уважает', () => {
    expect(historyRow(runOf()).prompt).toBe('—');
    const withRunPrompt = runOf() as EvalRun & { promptVersion?: string };
    withRunPrompt.promptVersion = 'abcdef12';
    expect(historyRow(withRunPrompt).prompt).toBe('abcdef12');
  });

  it('модель заглушки подписывает как stub', () => {
    expect(historyRow(runOf({ mode: 'stub', model: 'stub' })).model).toBe('stub');
  });

  it('неизвестный оценщик в сводке не ломает строку', () => {
    const summary = summaryOf({ evaluators: [] });
    const row = historyRow(runOf({ summary }), { prompt: 'x' });
    expect(row.metrics).toEqual(HISTORY_METRICS.map(() => '—'));
  });
});

describe('quality: история настройки — версия промпта', () => {
  it('считает первые 8 символов sha256 и не зависит от длины файла', () => {
    const version = promptVersion('промпт агента intake');
    expect(version).toMatch(/^[0-9a-f]{8}$/);
    expect(promptVersion('промпт агента intake')).toBe(version);
    expect(promptVersion('промпт агента intake\n')).not.toBe(version);
    expect(promptVersion('промпт агента intake', 12)).toHaveLength(12);
  });
});

describe('quality: история настройки — рендер и разбор', () => {
  it('переживает round-trip: рендер → разбор → те же строки', () => {
    const rows = [
      rowOf(),
      rowOf({
        date: '2026-11-13T10:00:00.000Z',
        model: 'stub',
        prompt: '—',
        set: 'cases (1)',
        metrics: HISTORY_METRICS.map(() => '—'),
        met: 3,
        withThreshold: 11,
      }),
    ];
    expect(parseHistory(renderHistory(rows))).toEqual(rows);
  });

  it('новые строки сверху, пустая история — таблица с подсказкой', () => {
    const older = rowOf({ date: '2026-11-13T10:00:00.000Z' });
    const newer = rowOf({ date: '2026-11-14T10:00:00.000Z' });
    const markdown = appendHistory(renderHistory([older]), newer);
    expect(parseHistory(markdown).map((row) => row.date)).toEqual([newer.date, older.date]);

    const empty = renderHistory([]);
    expect(empty).toContain('Прогонов пока нет');
    expect(parseHistory(empty)).toEqual([]);
    expect(parseHistory('')).toEqual([]);
  });

  it('пишет строку «порогов X из 11» и итог последнего прогона', () => {
    const markdown = renderHistory([rowOf({ met: 7, withThreshold: 11 })]);
    expect(markdown).toContain('| 7 из 11 |');
    expect(markdown).toContain('Порогов в последнем прогоне: 7 из 11.');
  });

  it('экранирует вертикальную черту в значениях и возвращает её при разборе', () => {
    const row = rowOf({ model: 'model|special', set: 'cases (10)' });
    const parsed = parseHistory(renderHistory([row]));
    expect(parsed).toEqual([row]);
  });
});

describe('quality: история настройки — дубли', () => {
  it('повторный прогон с теми же датой, моделью и версией не дублируется', () => {
    const row = rowOf();
    const once = appendHistory('', row);
    const twice = appendHistory(once, row);
    expect(parseHistory(twice)).toHaveLength(1);
  });

  it('другая версия промпта при тех же дате и модели — отдельная строка', () => {
    const first = rowOf();
    const second = rowOf({ prompt: 'ffffffff', met: 9 });
    const markdown = appendHistory(appendHistory('', first), second);
    expect(parseHistory(markdown)).toHaveLength(2);
    expect(parseHistory(markdown)[0]?.prompt).toBe('ffffffff');
  });

  it('другая дата — новый прогон, даже если модель и промпт те же', () => {
    const first = rowOf();
    const second = rowOf({ date: '2026-11-15T09:00:00.000Z' });
    expect(parseHistory(appendHistory(appendHistory('', first), second))).toHaveLength(2);
  });
});

describe('quality: история настройки — битые строки', () => {
  const valid = renderHistory([rowOf()]);

  it('пропускает строки с неверным числом колонок', () => {
    const broken = [
      '| 2026-11-15 | модель | промпт |',
      '| строка | без | конца',
      `| ${['x', 'y'].join(' | ')} |`,
    ].join('\n');
    expect(parseHistory(`${valid}\n${broken}`)).toEqual([rowOf()]);
  });

  it('пропускает строку без счётчика порогов', () => {
    const cells = ['2026-11-15T00:00:00.000Z', 'stub', '—', 'cases (1)', ...HISTORY_METRICS.map(() => '—'), 'много'];
    expect(cells).toHaveLength(COLUMNS);
    expect(parseHistory(`| ${cells.join(' | ')} |`)).toEqual([]);
  });

  it('пропускает строку без даты и модель, заголовок и разделитель', () => {
    const noDate = ['', 'stub', '—', 'cases (1)', ...HISTORY_METRICS.map(() => '—'), '1 из 11'];
    const noModel = ['2026-11-15', '', '—', 'cases (1)', ...HISTORY_METRICS.map(() => '—'), '1 из 11'];
    const broken = [
      `| ${noDate.join(' | ')} |`,
      `| ${noModel.join(' | ')} |`,
      `| ${Array.from({ length: COLUMNS }, () => '---').join(' | ')} |`,
    ].join('\n');
    expect(parseHistory(broken)).toEqual([]);
  });

  it('не падает на мусоре вокруг таблицы', () => {
    const markdown = ['# Заголовок', '', valid, '', 'Порогов в последнем прогоне: 7 из 11.', 'хвост'].join('\n');
    expect(parseHistory(markdown)).toEqual([rowOf()]);
  });
});
