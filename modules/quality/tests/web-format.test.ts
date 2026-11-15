import { describe, expect, it } from 'vitest';
import type { QualityCase, QualityMetric, QualityReport } from '../contracts';
import {
  CELL_MARK,
  QUALITY_COLUMNS,
  caseRows,
  cellState,
  metricRows,
  summaryText,
  thresholdState,
} from '../web/format';

function qualityCase(patch: Partial<QualityCase> = {}): QualityCase {
  return {
    id: 'case-01',
    title: 'Принтер не печатает',
    fields: { correct: 10, total: 10, invented: 0 },
    priority: true,
    emergency: 'ok',
    assigneeTop1: true,
    assigneeTop3: true,
    article: true,
    question: true,
    steps: 5,
    details: [],
    ...patch,
  };
}

function metric(patch: Partial<QualityMetric> = {}): QualityMetric {
  return {
    key: 'fields',
    title: 'Поля',
    value: 1,
    display: '100 %',
    ideal: '100 %',
    threshold: '≥ 90 %',
    passed: true,
    total: 10,
    ...patch,
  };
}

function report(patch: Partial<QualityReport> = {}): QualityReport {
  return {
    empty: false,
    startedAt: '2026-11-14T16:07:25.365Z',
    finishedAt: null,
    model: 'stub',
    set: 'cases',
    duration: '2,0 с',
    cases: [qualityCase()],
    summary: {
      cases: 1,
      met: 1,
      withThreshold: 1,
      failedSteps: 0,
      metrics: [metric()],
    },
    notes: [],
    ...patch,
  };
}

describe('quality web: клетки таблицы', () => {
  it('успешный кейс — все семь колонок зелёные', () => {
    const item = qualityCase();
    expect(QUALITY_COLUMNS).toHaveLength(7);
    for (const column of QUALITY_COLUMNS) {
      expect(cellState(item, column.key)).toBe('ok');
    }
  });

  it('ошибки, выдуманные поля и пропуск аварии — красные', () => {
    const item = qualityCase({
      fields: { correct: 9, total: 10, invented: 2 },
      priority: false,
      emergency: 'miss',
      assigneeTop1: false,
      assigneeTop3: false,
      article: false,
      question: false,
    });
    expect(cellState(item, 'fields')).toBe('fail');
    expect(cellState(item, 'invented')).toBe('fail');
    expect(cellState(item, 'priority')).toBe('fail');
    expect(cellState(item, 'emergency')).toBe('fail');
    expect(cellState(item, 'assignee')).toBe('fail');
    expect(cellState(item, 'article')).toBe('fail');
    expect(cellState(item, 'question')).toBe('fail');
  });

  it('исполнитель в топ-3 — тоже верно, различие видно в подсказке', () => {
    const item = qualityCase({ assigneeTop1: false, assigneeTop3: true });
    expect(cellState(item, 'assignee')).toBe('ok');
    expect(caseRows([item])[0]?.cells.find((cell) => cell.key === 'assignee')?.hint).toContain('топ-3');
  });

  it('нет эталона — «?», а не «всё хорошо»', () => {
    const item = qualityCase({
      fields: { correct: 0, total: 0, invented: 0 },
      priority: null,
      emergency: null,
      assigneeTop1: null,
      article: null,
      question: null,
    });
    expect(cellState(item, 'fields')).toBe('none');
    expect(cellState(item, 'invented')).toBe('none');
    expect(cellState(item, 'emergency')).toBe('none');
    expect(cellState(null, 'priority')).toBe('none');
    expect(CELL_MARK.none).toBe('?');
  });

  it('битые данные не роняют строки таблицы', () => {
    const broken = [
      { id: '', title: '', fields: null, priority: 'нет', details: 'мусор', steps: -3 },
      null,
    ] as unknown as QualityCase[];
    const rows = caseRows(broken);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe('—');
    expect(rows[0]?.title).toBe('Без названия');
    expect(rows[0]?.cells).toHaveLength(7);
    expect(rows[0]?.cells.every((cell) => cell.state === 'none')).toBe(true);
    expect(rows[0]?.details).toEqual([]);
    expect(rows[0]?.steps).toBe(0);
    expect(caseRows(null)).toEqual([]);
  });

  it('строка несёт подробности и число шагов', () => {
    const rows = caseRows([
      qualityCase({ details: ['поля · object: эталон «сеть», ИИ «сеть и интернет»', ''] }),
    ]);
    expect(rows[0]?.details).toEqual(['поля · object: эталон «сеть», ИИ «сеть и интернет»']);
    expect(rows[0]?.steps).toBe(5);
  });
});

describe('quality web: сводка и пороги', () => {
  it('порог выполнен, не выполнен и не проверялся', () => {
    expect(thresholdState(metric())).toBe('met');
    expect(thresholdState(metric({ passed: false, display: '84 %' }))).toBe('unmet');
    expect(thresholdState(metric({ passed: true, total: 0, display: '—' }))).toBe('none');
    expect(thresholdState(null)).toBe('none');
  });

  it('строки метрик сохраняют подписи и состояние', () => {
    const rows = metricRows([metric(), metric({ key: 'priority', title: 'Приоритет', passed: false })]);
    expect(rows.map((row) => row.state)).toEqual(['met', 'unmet']);
    expect(rows[1]?.threshold).toBe('≥ 90 %');
    expect(metricRows(null)).toEqual([]);
  });

  it('сводка без отчёта зовёт прогнать набор', () => {
    expect(summaryText(null)).toContain('Прогнать набор');
    expect(summaryText(report({ empty: true }))).toContain('Прогнать набор');
  });

  it('сводка считает обращения и выполненные пороги', () => {
    expect(summaryText(report())).toBe('1 обращение · выполнено 1 из 1 порогов');
    expect(
      summaryText(report({ summary: { cases: 10, met: 7, withThreshold: 11, failedSteps: 0, metrics: [] } })),
    ).toBe('10 обращений · выполнено 7 из 11 порогов');
  });

  it('битая сводка не ломает подпись', () => {
    const broken = {
      empty: false,
      cases: [qualityCase()],
      summary: { cases: 'много' },
    } as unknown as QualityReport;
    expect(summaryText(broken)).toBe('0 обращений: пороги не заданы');
  });
});
