import { describe, expect, it } from 'vitest';
import type { FieldDef } from '@ugra/contracts';
import type { CaseEvaluation, ObservedRun } from '../server/metrics';
import {
  THRESHOLDS,
  compareField,
  evaluateArticle,
  evaluateAssignee,
  evaluateEmergency,
  evaluateFields,
  evaluatePriority,
  evaluateQuestion,
  evaluateTrajectory,
  evalModeOf,
  median,
  normalizeText,
  quoteInText,
  sameFieldValue,
  summarize,
} from '../server/metrics';

const text = 'В корпусе Б, кабинет 312, принтер HP не печатает, мигает красный индикатор';

function fieldDef(key: string, evalMode: FieldDef['evalMode']): FieldDef {
  return {
    key,
    label: key,
    group: 'classification',
    type: 'string',
    required: true,
    extractHint: '',
    evalMode,
  };
}

function observed(patch: Partial<ObservedRun> = {}): ObservedRun {
  return { text, fields: {}, ...patch };
}

function field(value: string | null, quote: string | null = null, origin = 'text') {
  return { value, quoteText: quote, origin };
}

function evaluation(patch: Partial<CaseEvaluation> = {}): CaseEvaluation {
  const emptyFields = { total: 0, hits: 0, rate: 0, outcomes: [], fabricated: [] };
  return {
    id: 'case-test',
    fields: emptyFields,
    priority: null,
    emergency: null,
    assignee: null,
    article: null,
    question: null,
    trajectory: null,
    ms: 1000,
    costRub: 0,
    steps: 1,
    errors: [],
    ...patch,
  };
}

function fieldsOf(hits: number, total: number, fabricated = 0): CaseEvaluation['fields'] {
  return {
    total,
    hits,
    rate: total === 0 ? 0 : hits / total,
    outcomes: [],
    fabricated: fabricated > 0 ? Array.from({ length: fabricated }, (_item, index) => ({
      key: `extra-${index}`,
      value: 'x',
      reason: 'в эталоне поле пусто',
    })) : [],
  };
}

describe('quality: нормализация и режимы сравнения полей', () => {
  it('сравнивает exact без нормализации, normalized — без регистра и ё', () => {
    expect(sameFieldValue('exact', 'printer', 'Printer')).toBe(false);
    expect(sameFieldValue('normalized', 'Принтер Ёж', 'принтер еж')).toBe(true);
    expect(compareField('category', 'printer', 'Printer', 'exact').hit).toBe(false);
    expect(compareField('category', 'printer', 'Printer', 'normalized').hit).toBe(true);
  });

  it('берёт режим из реестра полей, вне реестра — normalized', () => {
    const fields = [fieldDef('category', 'exact'), fieldDef('building', 'normalized')];
    expect(evalModeOf('category', fields)).toBe('exact');
    expect(evalModeOf('building', fields)).toBe('normalized');
    expect(evalModeOf('нет-такого', fields)).toBe('normalized');
  });

  it('поле с evalMode none не сравнивается, пустой эталон требует пустого ответа', () => {
    const fields = [fieldDef('symptoms', 'none')];
    const report = evaluateFields({ symptoms: 'текст', cabinet: null }, observed(), fields);
    expect(report.total).toBe(1);
    expect(report.outcomes[0]?.key).toBe('cabinet');
    expect(report.outcomes[0]?.hit).toBe(true);
  });

  it('находит цитату в тексте без регистра и лишних пробелов', () => {
    expect(normalizeText('  Корпусе   Б ')).toBe('корпусе б');
    expect(quoteInText(text, 'КАБИНЕТ 312')).toBe(true);
    expect(quoteInText(text, 'кабинет 999')).toBe(false);
  });
});

describe('quality: поля эталона и выдуманные поля', () => {
  it('считает попадания и промахи по эталону', () => {
    const report = evaluateFields(
      { building: 'Б', cabinet: '312', equipment: null },
      observed({
        fields: {
          building: field('Б', 'корпусе Б'),
          cabinet: field('999', 'кабинет 312'),
        },
      }),
      [fieldDef('building', 'normalized'), fieldDef('cabinet', 'normalized')],
    );

    expect(report.total).toBe(3);
    expect(report.hits).toBe(2);
    expect(report.outcomes.find((item) => item.key === 'cabinet')?.hit).toBe(false);
    expect(report.outcomes.find((item) => item.key === 'equipment')?.hit).toBe(true);
    expect(report.rate).toBeCloseTo(2 / 3);
  });

  it('считает выдуманным поле, которого нет в эталоне', () => {
    const report = evaluateFields(
      { building: 'Б' },
      observed({ fields: { building: field('Б', 'корпусе Б'), serial: field('SN-1234', 'принтер') } }),
    );
    expect(report.fabricated).toHaveLength(1);
    expect(report.fabricated[0]?.key).toBe('serial');
    expect(report.fabricated[0]?.reason).toMatch(/в эталоне поле пусто/);
  });

  it('считает выдуманным поле с цитатой не из текста и поле без цитаты', () => {
    const report = evaluateFields(
      { building: 'Б' },
      observed({
        fields: {
          building: field('Б', 'корпусе Б'),
          cabinet: field('312', 'кабинет 999'),
          category: field('printer', null),
        },
      }),
    );
    expect(report.fabricated.map((item) => item.key).sort()).toEqual(['cabinet', 'category']);
    expect(report.fabricated.find((item) => item.key === 'cabinet')?.reason).toMatch(/цитаты нет в тексте/);
    expect(report.fabricated.find((item) => item.key === 'category')?.reason).toBe('нет цитаты');
  });

  it('не считает выдумкой значение, которое нашёл код в CMDB', () => {
    const report = evaluateFields(
      { building: 'Б' },
      observed({
        fields: {
          building: field('Б', 'корпусе Б'),
          inventoryNo: field('INV-000312', null, 'cmdb'),
          ip: field('10.10.3.12', null, 'cmdb'),
        },
      }),
    );
    expect(report.fabricated).toEqual([]);
  });

  it('пустое обращение: любое заполненное поле — выдумка', () => {
    const report = evaluateFields(
      { object: null, cabinet: null },
      observed({ fields: { object: field('принтер', 'принтер') } }),
    );
    expect(report.fabricated.map((item) => item.key)).toEqual(['object']);
    expect(report.hits).toBe(1);
  });
});

describe('quality: приоритет, авария, исполнитель, статья, вопрос, траектория', () => {
  it('приоритет сравнивает уровень, без эталона — null', () => {
    expect(evaluatePriority('high', observed({ priority: 'high' }))).toBe(true);
    expect(evaluatePriority('high', observed({ priority: 'medium' }))).toBe(false);
    expect(evaluatePriority(undefined, observed({ priority: 'high' }))).toBeNull();
  });

  it('авария отделяет пропуск от ложной тревоги', () => {
    expect(evaluateEmergency(true, observed({ emergency: false }))).toMatchObject({ miss: true, falseAlarm: false });
    expect(evaluateEmergency(false, observed({ emergency: true }))).toMatchObject({ miss: false, falseAlarm: true });
    expect(evaluateEmergency(true, observed({ emergency: true }))).toMatchObject({ miss: false, falseAlarm: false });
    expect(evaluateEmergency(undefined, observed())).toBeNull();
  });

  it('исполнитель: топ-1 и топ-3 по эталону, пустой эталон — null', () => {
    const top1 = evaluateAssignee(['u-2', 'u-4', 'u-3'], observed({ assignees: ['u-2', 'u-1'] }));
    expect(top1).toMatchObject({ top1: true, top3: true });
    const top3 = evaluateAssignee(['u-2', 'u-4', 'u-3'], observed({ assignees: ['u-1', 'u-4'] }));
    expect(top3).toMatchObject({ top1: false, top3: true });
    expect(evaluateAssignee(['u-2', 'u-4', 'u-3'], observed({ assignees: ['u-9'] }))).toMatchObject({
      top1: false,
      top3: false,
    });
    expect(evaluateAssignee([], observed({ assignees: ['u-2'] }))).toBeNull();
  });

  it('статья ищется в топ-3 выбранных', () => {
    expect(evaluateArticle('kb-1', observed({ articles: ['kb-9', 'kb-1'] }))).toBe(true);
    expect(evaluateArticle('kb-1', observed({ articles: ['kb-9', 'kb-8', 'kb-7', 'kb-1'] }))).toBe(false);
    expect(evaluateArticle('kb-1', observed({ articles: [] }))).toBe(false);
    expect(evaluateArticle(undefined, observed({ articles: ['kb-1'] }))).toBeNull();
  });

  it('вопрос: спрошено ли нужное поле', () => {
    expect(evaluateQuestion('cabinet', observed({ askedField: 'cabinet' }))).toBe(true);
    expect(evaluateQuestion('cabinet', observed({ askedField: 'building' }))).toBe(false);
    expect(evaluateQuestion(undefined, observed({ askedField: 'building' }))).toBeNull();
  });

  it('траектория: обязательные вызваны, запрещённые нет, шагов не больше лимита', () => {
    const ok = evaluateTrajectory(
      { mustCall: ['cmdb_find_equipment'], mustNotCall: ['kb_search'], maxSteps: 3 },
      observed({ tools: ['cmdb_find_equipment', 'submit'], steps: 2 }),
    );
    expect(ok?.ok).toBe(true);

    const bad = evaluateTrajectory(
      { mustCall: ['cmdb_find_equipment'], mustNotCall: ['kb_search'], maxSteps: 1 },
      observed({ tools: ['kb_search'], steps: 4 }),
    );
    expect(bad?.missing).toEqual(['cmdb_find_equipment']);
    expect(bad?.forbidden).toEqual(['kb_search']);
    expect(bad?.ok).toBe(false);
    expect(evaluateTrajectory(undefined, observed())).toBeNull();
  });
});

describe('quality: агрегаты и пороги', () => {
  it('медиана считает чётное и нечётное число значений', () => {
    expect(median([])).toBe(0);
    expect(median([3])).toBe(3);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBeCloseTo(2.5);
  });

  it('все пороги выполнены при хорошем прогоне', () => {
    const summary = summarize([
      evaluation({
        fields: fieldsOf(9, 10),
        priority: true,
        emergency: { expected: true, actual: true, miss: false, falseAlarm: false },
        assignee: { top1: true, top3: true, expected: ['u-1'], actual: ['u-1'] },
        article: true,
        question: true,
        trajectory: { ok: true, missing: [], forbidden: [], steps: 2, maxSteps: 3 },
        ms: 4000,
      }),
    ]);

    expect(summary.unmet).toEqual([]);
    expect(summary.met).toBe(summary.withThreshold);
    expect(summary.evaluators.find((item) => item.key === 'fields')?.display).toBe('90 %');
  });

  it('проваливает поля ниже 90 %, выдуманные поля, пропуск аварии и статью', () => {
    const summary = summarize([
      evaluation({
        fields: fieldsOf(7, 10, 2),
        priority: false,
        emergency: { expected: true, actual: false, miss: true, falseAlarm: false },
        assignee: { top1: false, top3: false, expected: ['u-1'], actual: [] },
        article: false,
        question: false,
        ms: 20_000,
        costRub: 0.9,
      }),
    ]);

    expect(summary.unmet.map((item) => item.key).sort()).toEqual([
      'article',
      'assigneeTop1',
      'assigneeTop3',
      'emergency',
      'fabricated',
      'fields',
      'price',
      'priority',
      'question',
      'time',
    ]);
    expect(summary.fabricatedTotal).toBe(2);
    expect(summary.emergencyMisses).toBe(1);
  });

  it('без эталона оценщик показывает «—» и не считается провалом', () => {
    const summary = summarize([evaluation({ fields: fieldsOf(3, 3), ms: 1000 })]);
    const byKey = new Map(summary.evaluators.map((item) => [item.key, item]));
    expect(byKey.get('article')?.display).toBe('—');
    expect(byKey.get('article')?.total).toBe(0);
    expect(byKey.get('article')?.passed).toBe(true);
    expect(byKey.get('article')?.note).toMatch(/нет эталона/);
    expect(byKey.get('price')?.display).toBe('—');
    expect(byKey.get('price')?.passed).toBe(true);
  });

  it('пороги полей и цены — из раздела 5.2 харнесса', () => {
    expect(THRESHOLDS.fields).toBe(0.9);
    expect(THRESHOLDS.fabricated).toBe(0);
    expect(THRESHOLDS.emergencyMisses).toBe(0);
    expect(THRESHOLDS.assigneeTop1).toBe(0.7);
    expect(THRESHOLDS.assigneeTop3).toBe(0.9);
    expect(THRESHOLDS.article).toBe(0.8);
    expect(THRESHOLDS.question).toBe(0.8);
    expect(THRESHOLDS.seconds).toBe(8);
    expect(THRESHOLDS.rub).toBe(0.3);
  });
});
