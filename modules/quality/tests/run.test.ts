import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { AgentStepRecord } from '@ugra/core';
import type { AnalysisDraft } from '@ugra/contracts';
import type { EvalCase } from '../server/run';
import {
  evalReportJson,
  observe,
  runEval,
  scenarioFromStub,
  selectCase,
  stubNumber,
  submitFromStub,
} from '../server/run';
import { renderConsole, renderQualityReport } from '../server/report';

const printerText =
  'Здравствуйте! В корпусе Б, кабинет 312, принтер HP LaserJet Pro M404dn мигает красный индикатор и ничего не печатает.';

const printerStub = {
  fields: [
    { key: 'object', value: 'принтер', quote: 'принтер', confidence: 0.96 },
    { key: 'building', value: 'Б', quote: 'корпусе Б', confidence: 0.98 },
    { key: 'cabinet', value: '312', quote: 'кабинет 312', confidence: 0.98 },
    {
      key: 'equipment',
      value: 'HP LaserJet Pro M404dn',
      quote: 'принтер HP LaserJet Pro M404dn',
      confidence: 0.95,
    },
    { key: 'category', value: 'printer', quote: 'принтер', confidence: 0.97 },
    {
      key: 'symptoms',
      value: 'мигает красный индикатор и ничего не печатает',
      quote: 'мигает красный индикатор и ничего не печатает',
      confidence: 0.94,
    },
  ],
  aspects: {
    emergency: { suspected: false, signs: [], confidence: 0.08 },
    summary: { text: 'Принтер HP в кабинете 312 не печатает.' },
  },
};

const directories = mkdtempSync(join(tmpdir(), 'quality-eval-'));

function writeFixture(name: string, value: unknown): void {
  mkdirSync(join(directories, name, '..'), { recursive: true });
  writeFileSync(join(directories, name), JSON.stringify(value, null, 2), 'utf8');
}

function prepareFixtures(): { casesDir: string; stubsDir: string } {
  const casesDir = join(directories, 'cases');
  const stubsDir = join(directories, 'stubs');
  writeFixture('cases/91-printer.json', {
    id: 'case-91',
    channel: 'chat',
    text: printerText,
    expected: {
      fields: {
        object: 'принтер',
        building: 'Б',
        cabinet: '312',
        equipment: 'HP LaserJet Pro M404dn',
        category: 'printer',
        symptoms: 'мигает красный индикатор и ничего не печатает',
      },
    },
  });
  writeFixture('cases/92-garbage.json', {
    id: 'case-92',
    channel: 'chat',
    text: 'Опять ничего не работает, помогите пожалуйста.',
    expected: {
      fields: { cabinet: '999' },
      priority: 'emergency',
      emergency: true,
      kbArticle: 'kb-none',
      question: 'serial',
      assigneeTop3: ['u-нет-такого'],
    },
  });
  writeFileSync(join(casesDir, '93-broken.json'), '{ это не json', 'utf8');
  writeFixture('stubs/91.json', printerStub);
  writeFixture('stubs/92.json', { fields: [] });
  return { casesDir, stubsDir };
}

afterAll(() => {
  rmSync(directories, { recursive: true, force: true });
});

function stepRecord(patch: Partial<AgentStepRecord> = {}): AgentStepRecord {
  return {
    n: 1,
    tool: 'submit',
    args: {},
    resultSummary: 'результат принят',
    blocked: false,
    durationMs: 1,
    runId: 'run-1',
    createdAt: '2026-11-14T10:00:00.000Z',
    ...patch,
  };
}

function draftOf(patch: Partial<AnalysisDraft> = {}): AnalysisDraft {
  return {
    sources: [{ id: 'a-1', kind: 'text', text: printerText }],
    fields: {},
    missing: [],
    ext: {},
    ...patch,
  };
}

function evalCaseOf(id: string, file: string): EvalCase {
  return { id, file, channel: 'chat', text: printerText, expected: {}, turns: 0 };
}

describe('quality: заглушка модели → сценарий агента', () => {
  it('приводит записанный ответ к submit агента intake', () => {
    const submit = submitFromStub(printerStub);
    expect(submit.fields).toHaveLength(6);
    expect(submit.emergency).toEqual({ suspected: false, signs: [], confidence: 0.08 });
    expect(submit.clarify).toBeNull();
    expect(submit.summary).toBe('Принтер HP в кабинете 312 не печатает.');
  });

  it('без аспектов подставляет безопасные значения', () => {
    const submit = submitFromStub({ fields: [] });
    expect(submit.emergency.suspected).toBe(false);
    expect(submit.summary).toBe('');
  });

  it('битую заглушку объясняет ошибкой, а не падением', () => {
    expect(() => submitFromStub({ fields: [{ value: 1 }] })).toThrow(/заглушка не разобрана/);
  });

  it('добавляет второй ход, если в записи есть поля без цитаты', () => {
    expect(scenarioFromStub(printerStub)).toHaveLength(1);
    const withUnquoted = {
      fields: [
        ...printerStub.fields,
        { key: 'impact', value: 'one', quote: null, confidence: 0.8 },
      ],
    };
    const scenario = scenarioFromStub(withUnquoted);
    expect(scenario).toHaveLength(2);
    expect((scenario[0]?.submit as { fields: unknown[] }).fields).toHaveLength(7);
    expect((scenario[1]?.submit as { fields: unknown[] }).fields).toHaveLength(6);
  });

  it('берёт номер заглушки из имени файла', () => {
    expect(stubNumber(evalCaseOf('case-04', '04-network'))).toBe('04');
    expect(stubNumber(evalCaseOf('case-нет', 'нет-номера'))).toBeNull();
  });
});

describe('quality: выбор кейса', () => {
  const cases = [
    evalCaseOf('case-04', '04-network-building-outage'),
    evalCaseOf('case-10', '10-phone-mfu-scan'),
  ];

  it('выбирает по номеру, имени файла и id', () => {
    expect(selectCase(cases, '04').map((item) => item.id)).toEqual(['case-04']);
    expect(selectCase(cases, 'case-10').map((item) => item.file)).toEqual(['10-phone-mfu-scan']);
    expect(selectCase(cases, '10-phone').map((item) => item.id)).toEqual(['case-10']);
  });

  it('без ключа отдаёт весь набор, на неизвестном кейсе — ошибка', () => {
    expect(selectCase(cases, '')).toHaveLength(2);
    expect(() => selectCase(cases, '99')).toThrow(/не найден/);
  });
});

describe('quality: что видит оценщик в черновике', () => {
  it('собирает поля, приоритет, исполнителей, статьи и вопрос', () => {
    const observed = observe(
      draftOf({
        fields: {
          cabinet: {
            key: 'cabinet',
            value: '312',
            confidence: 0.9,
            quote: { sourceId: 'a-1', text: 'кабинет 312' },
            origin: 'text',
            needsReview: false,
            trace: [],
          },
          inventoryNo: {
            key: 'inventoryNo',
            value: 'INV-000312',
            confidence: 1,
            quote: null,
            origin: 'cmdb',
            needsReview: false,
            trace: [],
          },
        },
        priority: {
          value: 'high',
          reactDueAt: null,
          slaDueAt: '2026-11-14T18:00:00.000Z',
          rule: 'one × down',
          reasons: [],
        },
        assignees: [
          { userId: 'u-2', score: 10, reasons: [] },
          { userId: 'u-4', score: 8, reasons: [] },
        ],
        knowledge: [{ kind: 'article', id: 'kb-print-red-indicator', title: 'Принтер', score: 3 }],
        ext: { extraction: { clarify: { fieldKey: 'cabinet', question: 'Кабинет?', options: [] } } },
      }),
      [
        stepRecord({ n: 1, tool: 'cmdb_find_equipment' }),
        stepRecord({ n: 2, tool: 'kb_get_article', args: { id: 'kb-1c-access' } }),
        stepRecord({ n: 3, tool: 'submit' }),
      ],
    );

    expect(observed.fields.cabinet?.value).toBe('312');
    expect(observed.fields.cabinet?.quoteText).toBe('кабинет 312');
    expect(observed.fields.inventoryNo?.origin).toBe('cmdb');
    expect(observed.priority).toBe('high');
    expect(observed.assignees).toEqual(['u-2', 'u-4']);
    expect(observed.articles).toEqual(['kb-print-red-indicator', 'kb-1c-access']);
    expect(observed.askedField).toBe('cabinet');
    expect(observed.tools).toEqual(['cmdb_find_equipment', 'kb_get_article', 'submit']);
    expect(observed.steps).toBe(3);
    expect(observed.emergency).toBe(false);
  });

  it('аварию берёт из вердикта или из мнения агента', () => {
    const verdict = observe(
      draftOf({
        emergency: { level: 'suspected', signs: [], confidence: 0.9, rulesMatched: [], checklist: [], notifyUserIds: [] },
      }),
    );
    expect(verdict.emergency).toBe(true);

    const opinion = observe(draftOf({ ext: { extraction: { emergency: { suspected: true } } } }));
    expect(opinion.emergency).toBe(true);

    const quiet = observe(draftOf({ emergency: { level: 'none', signs: [], confidence: 0, rulesMatched: [], checklist: [], notifyUserIds: [] } }));
    expect(quiet.emergency).toBe(false);
  });
});

describe('quality: прогон на фикстурах', () => {
  it('гоняет хороший и мусорный эталон и пишет отчёт без падения', async () => {
    const run = await runEval({ dirs: prepareFixtures() });

    expect(run.mode).toBe('stub');
    expect(run.cases.map((item) => item.evalCase.id)).toEqual(['case-91', 'case-92']);
    expect(run.skipped).toHaveLength(1);
    expect(run.skipped[0]?.file).toBe('93-broken.json');

    const good = run.cases[0]?.evaluation;
    expect(good?.fields.rate).toBe(1);
    expect(good?.fields.fabricated).toEqual([]);
    expect(good?.errors).toEqual([]);

    const garbage = run.cases[1]?.evaluation;
    expect(garbage?.fields.hits).toBe(0);
    expect(garbage?.priority).toBe(false);
    expect(garbage?.emergency?.miss).toBe(true);
    expect(garbage?.article).toBe(false);
    expect(garbage?.question).toBe(false);
    expect(garbage?.assignee?.top1).toBe(false);

    expect(run.summary.cases).toBe(2);
    expect(run.summary.fabricatedTotal).toBe(0);
    expect(run.summary.failedSteps).toBe(0);
    expect(run.summary.emergencyMisses).toBe(1);
    const unmet = run.summary.unmet.map((item) => item.key);
    expect(unmet).toContain('fields');
    expect(unmet).toContain('emergency');
    expect(unmet).toContain('priority');
    expect(unmet).toContain('article');
    expect(unmet).not.toContain('fabricated');

    const markdown = renderQualityReport(run);
    expect(markdown).toContain('Таблица «эталон / ИИ»');
    expect(markdown).toContain('case-91');
    expect(markdown).toContain('testset/dev');
    expect(markdown).toContain('93-broken.json');
    expect(renderConsole(run)).toContain('НЕ ВЫПОЛНЕНО');

    const json = JSON.parse(evalReportJson(run)) as {
      summary: { cases: number };
      cases: { id: string; trace: string[] }[];
    };
    expect(json.summary.cases).toBe(2);
    expect(json.cases[0]?.id).toBe('case-91');
    expect(json.cases[0]?.trace.length).toBeGreaterThan(0);
  }, 30_000);

  it('--case оставляет один кейс с трассировкой', async () => {
    const run = await runEval({ dirs: prepareFixtures(), caseId: '91' });
    expect(run.cases).toHaveLength(1);
    expect(run.cases[0]?.evalCase.id).toBe('case-91');
    expect(run.cases[0]?.trace.join('\n')).toMatch(/шаги агента/);
    expect(run.cases[0]?.stepMetrics.map((item) => item.stepId)).toContain('agent.intake');
  }, 30_000);

  it('несуществующий кейс — понятная ошибка', async () => {
    await expect(runEval({ dirs: prepareFixtures(), caseId: '77' })).rejects.toThrow(/не найден/);
  }, 30_000);
});
