import { describe, expect, it } from 'vitest';
import { QualityReport } from '../contracts';
import type { EvalRun } from '../server/run';
import {
  emptyReport,
  applyCaseTitles,
  parseQualityReport,
  reportFromRun,
  unreadableReport,
} from '../server/report-data';

const MARKDOWN = `# Качество разбора: эталон / ИИ

Сгенерировано \`pnpm eval\` — тот же движок и тот же набор, что в демо.

| | |
|---|---|
| Прогон | 2026-11-14T16:07:25.365Z |
| Набор | контрольный \`testset/cases\` — 10 обращений |
| Модель | \`deepseek/deepseek-v4.1-flash-1017\`, облако (Polza) |
| Длительность | 147,3 с |
| Порогов выполнено | 7 из 11 |
| Шагов с ошибкой | 0 |

## Таблица «эталон / ИИ»

| Оценщик | Эталон | ИИ | Порог | Итог |
|---|---|---|---|---|
| Поля | 100 % | 84 % | ≥ 90 % | ❌ |
| Выдуманные поля | 0 | 9 | 0 | ❌ |
| Нужный вопрос заявителю _(в наборе нет эталона вопроса)_ | 100 % | — | ≥ 80 % | ✅ |

## По обращениям

| Кейс | Поля | Приоритет | Авария | Исполнитель | Статья | Вопрос | Шагов | Время |
|---|---|---|---|---|---|---|---|---|
| case-01 | 10/11 (91 %) | ✅ | ✅ | топ-1 | ✅ | — | 5 | 14,4 с |
| case-04 | 5/7 (71 %) +1 выд. | ✅ | ✅ | топ-3 | — | — | 5 | 16,5 с |
| case-10 | 8/10 (80 %) +1 выд. | ❌ | ❌ ложная | топ-1 | ✅ | — | 5 | 14,1 с |

## Провалы по оценщикам

### case-04

- поля · object: эталон «сеть», ИИ «сеть и интернет» (normalized)
- выдуманное поле · equipment = «Компьютер»: в эталоне поле пусто

## Оговорки

- Контрольный набор — 10 обращений, это критерий К1.
- Настроечного набора \`testset/dev/\` нет, поэтому цифры могут быть завышены.
`;

describe('quality report: разбор reports/quality.md', () => {
  it('читает шапку, оценщиков, обращения и оговорки', () => {
    const report = parseQualityReport(MARKDOWN);
    expect(QualityReport.safeParse(report).success).toBe(true);
    expect(report.empty).toBe(false);
    expect(report.startedAt).toBe('2026-11-14T16:07:25.365Z');
    expect(report.model).toContain('deepseek/deepseek-v4.1-flash-1017');
    expect(report.set).toContain('testset/cases');
    expect(report.duration).toBe('147,3 с');
    expect(report.summary).toMatchObject({ cases: 3, met: 7, withThreshold: 11, failedSteps: 0 });
    expect(report.summary.metrics).toHaveLength(3);
    expect(report.summary.metrics[0]).toMatchObject({ key: 'fields', display: '84 %', passed: false });
    expect(report.summary.metrics[2]).toMatchObject({
      key: 'question',
      total: 0,
      note: 'в наборе нет эталона вопроса',
    });
    expect(report.cases).toHaveLength(3);
    expect(report.cases[0]).toMatchObject({
      id: 'case-01',
      fields: { correct: 10, total: 11, invented: 0 },
      priority: true,
      emergency: 'ok',
      assigneeTop1: true,
      assigneeTop3: true,
      article: true,
      question: null,
      steps: 5,
    });
    expect(report.cases[1]).toMatchObject({
      fields: { correct: 5, total: 7, invented: 1 },
      assigneeTop1: false,
      assigneeTop3: true,
      article: null,
    });
    expect(report.cases[2]?.emergency).toBe('false');
    expect(report.cases[1]?.details).toHaveLength(2);
    expect(report.notes[0]).toContain('Контрольный набор');
  });

  it('подставляет названия обращений из набора, если они есть', () => {
    const report = applyCaseTitles(
      parseQualityReport(MARKDOWN),
      new Map([['case-01', 'Принтер HP не печатает']]),
    );
    expect(report.cases[0]?.title).toBe('Принтер HP не печатает');
    expect(report.cases[1]?.title).toBe('case-04');
    expect(applyCaseTitles(parseQualityReport(MARKDOWN), new Map()).cases[0]?.title).toBe('case-01');
  });

  it('пустой файл — пустой экран, а не ошибка', () => {
    expect(parseQualityReport('')).toEqual(emptyReport());
    expect(parseQualityReport('   \n').empty).toBe(true);
  });

  it('битые строки и незнакомые разделы пропускаются', () => {
    const broken = `# Отчёт

| | |
|---|---|
| Прогон | вчера |
| Порогов выполнено | нет данных |

## Таблица «эталон / ИИ»

| Оценщик | Эталон |
|---|---|
| Поля | 100 % |

## По обращениям

| Кейс | Поля |
|---|---|
| case-01 | 10/10 |

| case-02 | 1/2 (50 %) | ✅ | ✅ | топ-1 | ✅ | ✅ | 3 | 1 с |

## Незнакомый раздел

- что-то
`;
    const report = parseQualityReport(broken);
    expect(report.summary.cases).toBe(1);
    expect(report.summary.withThreshold).toBe(0);
    expect(report.cases[0]?.id).toBe('case-02');
    expect(report.cases[0]?.fields).toMatchObject({ correct: 1, total: 2 });
    expect(report.cases[0]?.details).toEqual([]);
    expect(report.summary.metrics).toEqual([]);
  });

  it('ошибка чтения файла — пустая страница с пометкой', () => {
    const report = unreadableReport(new Error('доступ запрещён'));
    expect(report.empty).toBe(true);
    expect(report.notes[0]).toContain('доступ запрещён');
  });
});

function caseRun(id: string, patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    evalCase: {
      id,
      text: `Обращение ${id}: принтер не печатает`,
      channel: 'chat',
      expected: {},
      turns: 0,
      file: id,
    },
    runId: `run-${id}`,
    status: 'ok',
    draft: {},
    observed: {},
    evaluation: {
      id,
      fields: {
        total: 10,
        hits: 9,
        rate: 0.9,
        outcomes: [],
        fabricated: [{ key: 'equipment', value: 'Компьютер', reason: 'в эталоне поле пусто' }],
      },
      priority: true,
      emergency: { expected: true, actual: false, miss: true, falseAlarm: false },
      assignee: { top1: false, top3: true, expected: ['u-1'], actual: ['u-2'] },
      article: true,
      question: null,
      trajectory: null,
      ms: 1500,
      costRub: 0,
      steps: 4,
      errors: [],
      ...patch,
    },
    stepMetrics: [],
    trace: [],
    warnings: [],
  };
}

function evalRun(cases: Record<string, unknown>[]): EvalRun {
  return {
    startedAt: '2026-11-14T16:00:00.000Z',
    finishedAt: '2026-11-14T16:00:03.000Z',
    mode: 'stub',
    model: 'stub',
    dirs: { dataDir: '/data', casesDir: '/repo/testset/cases', stubsDir: '/repo/testset/stubs' },
    cases,
    skipped: [],
    summary: {
      cases: cases.length,
      evaluators: [
        {
          key: 'fields',
          title: 'Поля',
          value: 0.9,
          display: '90 %',
          ideal: '100 %',
          threshold: '≥ 90 %',
          passed: true,
          total: 10,
        },
      ],
      unmet: [],
      fabricatedTotal: 1,
      emergencyMisses: 1,
      emergencyFalseAlarms: 0,
      failedSteps: 0,
      medianMs: 1500,
      medianCostRub: 0,
      met: 1,
      withThreshold: 1,
    },
    warnings: ['предупреждение прогона'],
  } as unknown as EvalRun;
}

describe('quality report: свежий прогон', () => {
  it('собирает компактный ответ экрана и ограничивает набор 10 кейсами', () => {
    const cases = Array.from({ length: 12 }, (_, index) => caseRun(`case-${index + 1}`));
    const report = reportFromRun(evalRun(cases));
    expect(QualityReport.safeParse(report).success).toBe(true);
    expect(report.empty).toBe(false);
    expect(report.cases).toHaveLength(10);
    expect(report.summary).toMatchObject({ cases: 10, met: 1, withThreshold: 1, failedSteps: 0 });
    expect(report.summary.metrics[0]).toMatchObject({ key: 'fields', display: '90 %' });
    expect(report.cases[0]).toMatchObject({
      id: 'case-1',
      fields: { correct: 9, total: 10, invented: 1 },
      priority: true,
      emergency: 'miss',
      assigneeTop1: false,
      assigneeTop3: true,
      article: true,
      question: null,
      steps: 4,
    });
    expect(report.cases[0]?.details.join('\n')).toContain('выдуманное поле');
    expect(report.duration).toBe('3,0 с');
    expect(report.notes.some((note) => note.includes('предупреждение прогона'))).toBe(true);
  });

  it('прогон без кейсов — пустой экран', () => {
    const report = reportFromRun(evalRun([]));
    expect(report.empty).toBe(true);
    expect(report.cases).toEqual([]);
  });
});
