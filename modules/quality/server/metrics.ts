import type { FieldDef } from '@ugra/contracts';

/**
 * Оценщики качества (раздел 5 спецификации `case9-agent-harness.md`).
 *
 * Здесь только чистые функции: на вход — эталон из `testset/cases/*.json` и то,
 * что дал прогон пайплайна; на выход — попадания, промахи и сводка с порогами.
 * Ни файлов, ни модели, ни базы: поэтому всё это проверяется тестами без прогона.
 */

export type EvalMode = 'exact' | 'normalized' | 'none';

/** Траектория агента из кейса: какие инструменты обязательны и сколько шагов допустимо. */
export interface CaseTrajectory {
  mustCall?: string[];
  mustNotCall?: string[];
  maxSteps?: number;
}

/** Эталон обращения: поля, приоритет, авария, топ-3 исполнителей, статья, вопрос. */
export interface CaseExpectation {
  fields?: Record<string, string | null>;
  priority?: string;
  emergency?: boolean;
  assigneeTop3?: string[];
  kbArticle?: string;
  question?: string;
  trajectory?: CaseTrajectory;
}

/** Поле после прогона: значение, цитата и происхождение (`text`, `cmdb`, `rule`…). */
export interface ObservedField {
  value: string | number | null | undefined;
  quoteText?: string | null;
  origin?: string;
}

/** Всё, что оценщики берут из одного прогона. */
export interface ObservedRun {
  /** Склеенный текст источников: по нему проверяются цитаты. */
  text: string;
  fields: Record<string, ObservedField>;
  priority?: string | null;
  emergency?: boolean;
  /** Топ исполнителей по порядку. */
  assignees?: string[];
  /** Выбранные статьи по порядку (топ-3). */
  articles?: string[];
  /** Поле, про которое агент спросил заявителя. */
  askedField?: string | null;
  /** Вызванные инструменты по порядку. */
  tools?: string[];
  /** Число шагов агента. */
  steps?: number;
}

/** Пороги из раздела 5.2 харнесса. Наши, стартовые: уточняются после первого прогона. */
export const THRESHOLDS = {
  fields: 0.9,
  priority: 0.9,
  assigneeTop1: 0.7,
  assigneeTop3: 0.9,
  article: 0.8,
  question: 0.8,
  trajectory: 1,
  /** Выдуманных полей и пропущенных аварий — ноль. */
  fabricated: 0,
  emergencyMisses: 0,
  /** Медиана на обращение: секунды и рубли. */
  seconds: 8,
  rub: 0.3,
} as const;

/** Сравнение текста без регистра, «ё → е» и лишних пробелов. */
export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

export function quoteInText(text: string, quote: string): boolean {
  const needle = normalizeText(quote);
  return needle.length > 0 && normalizeText(text).includes(needle);
}

/** Режим сравнения поля — из реестра `data/fields.json`; вне реестра сравниваем нормализованно. */
export function evalModeOf(key: string, fields: readonly FieldDef[] = []): EvalMode {
  return fields.find((field) => field.key === key)?.evalMode ?? 'normalized';
}

function textOfValue(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

export function sameFieldValue(mode: EvalMode, expected: string, actual: string): boolean {
  if (mode === 'none') return true;
  if (mode === 'exact') return expected.trim() === actual.trim();
  return normalizeText(expected) === normalizeText(actual);
}

export interface FieldOutcome {
  key: string;
  mode: EvalMode;
  expected: string | null;
  actual: string | null;
  hit: boolean;
}

/** Одно поле эталона: совпало или нет. Пусто в эталоне — должно быть пусто и в ответе. */
export function compareField(
  key: string,
  expected: string | null,
  actual: string | null,
  mode: EvalMode = 'normalized',
): FieldOutcome {
  const hit = expected === null ? actual === null : actual !== null && sameFieldValue(mode, expected, actual);
  return { key, mode, expected, actual, hit };
}

/** Заполненное поле, которого быть не должно: выдумка модели или цитата не из текста. */
export interface FieldIssue {
  key: string;
  value: string;
  reason: string;
}

export interface FieldReport {
  /** Сколько полей эталона сравнивали. */
  total: number;
  hits: number;
  rate: number;
  outcomes: FieldOutcome[];
  fabricated: FieldIssue[];
}

/**
 * Поля эталона по `evalMode` + выдуманные поля.
 *
 * Выдуманное: значение заполнено, а в эталоне пусто или поля нет; либо цитаты нет в тексте;
 * либо у значения текстового происхождения вообще нет цитаты. Значения, подтверждённые
 * кодом из CMDB (`origin: 'cmdb'`), выдуманными не считаются: их нашла не модель.
 */
export function evaluateFields(
  expected: Record<string, string | null> | undefined,
  observed: ObservedRun,
  fields: readonly FieldDef[] = [],
): FieldReport {
  const reference = expected ?? {};
  const outcomes: FieldOutcome[] = [];
  for (const [key, raw] of Object.entries(reference)) {
    const mode = evalModeOf(key, fields);
    if (mode === 'none') continue;
    outcomes.push(compareField(key, textOfValue(raw), textOfValue(observed.fields[key]?.value), mode));
  }

  const fabricated: FieldIssue[] = [];
  for (const [key, field] of Object.entries(observed.fields)) {
    const value = textOfValue(field.value);
    if (value === null) continue;
    const quote = textOfValue(field.quoteText);
    if (quote !== null) {
      if (observed.text.trim() !== '' && !quoteInText(observed.text, quote)) {
        fabricated.push({ key, value, reason: `цитаты нет в тексте: «${quote}»` });
      } else if (textOfValue(reference[key]) === null && field.origin !== 'cmdb') {
        fabricated.push({ key, value, reason: 'в эталоне поле пусто' });
      }
      continue;
    }
    if (field.origin === 'cmdb' || field.origin === 'human') continue;
    fabricated.push({ key, value, reason: 'нет цитаты' });
  }

  const hits = outcomes.filter((outcome) => outcome.hit).length;
  return {
    total: outcomes.length,
    hits,
    rate: outcomes.length === 0 ? 0 : hits / outcomes.length,
    outcomes,
    fabricated,
  };
}

/** Приоритет: совпал уровень или нет. `null` — в кейсе нет эталона. */
export function evaluatePriority(expected: string | undefined, observed: ObservedRun): boolean | null {
  if (typeof expected !== 'string' || expected.trim() === '') return null;
  return observed.priority === expected;
}

export interface EmergencyOutcome {
  expected: boolean;
  actual: boolean;
  /** Пропуск аварии — худший случай: порог «0 пропусков». */
  miss: boolean;
  /** Ложная тревога: аварии нет, а система её заподозрила. */
  falseAlarm: boolean;
}

/** Авария: пропуск и ложная тревога считаются отдельно. */
export function evaluateEmergency(
  expected: boolean | undefined,
  observed: ObservedRun,
): EmergencyOutcome | null {
  if (typeof expected !== 'boolean') return null;
  const actual = observed.emergency === true;
  return { expected, actual, miss: expected && !actual, falseAlarm: !expected && actual };
}

export interface AssigneeOutcome {
  top1: boolean;
  top3: boolean;
  expected: string[];
  actual: string[];
}

/** Исполнитель: попал в топ-1 и попал в топ-3. Пустой эталон — кейс не оцениваем. */
export function evaluateAssignee(
  expectedTop3: readonly string[] | undefined,
  observed: ObservedRun,
): AssigneeOutcome | null {
  const expected = (expectedTop3 ?? []).filter((id) => typeof id === 'string' && id.trim() !== '');
  if (expected.length === 0) return null;
  const actual = observed.assignees ?? [];
  const top1 = actual[0] !== undefined && expected.includes(actual[0]);
  const top3 = actual.slice(0, 3).some((userId) => expected.includes(userId));
  return { top1, top3, expected, actual };
}

/** Статья: нужная статья среди выбранных (топ-3). `null` — статьи в эталоне нет. */
export function evaluateArticle(expectedId: string | undefined, observed: ObservedRun): boolean | null {
  if (typeof expectedId !== 'string' || expectedId.trim() === '') return null;
  return (observed.articles ?? []).slice(0, 3).includes(expectedId);
}

/** Вопрос: спрошено ли именно то поле, которого не хватало. `null` — эталона вопроса нет. */
export function evaluateQuestion(expectedField: string | undefined, observed: ObservedRun): boolean | null {
  if (typeof expectedField !== 'string' || expectedField.trim() === '') return null;
  return observed.askedField === expectedField;
}

export interface TrajectoryOutcome {
  ok: boolean;
  missing: string[];
  forbidden: string[];
  steps: number;
  maxSteps: number | null;
}

/** Траектория: обязательные инструменты вызваны, запрещённые — нет, шагов не больше лимита. */
export function evaluateTrajectory(
  trajectory: CaseTrajectory | undefined,
  observed: ObservedRun,
): TrajectoryOutcome | null {
  if (!trajectory) return null;
  const calls = observed.tools ?? [];
  const missing = (trajectory.mustCall ?? []).filter((tool) => !calls.includes(tool));
  const forbidden = (trajectory.mustNotCall ?? []).filter((tool) => calls.includes(tool));
  const steps = observed.steps ?? calls.length;
  const maxSteps = trajectory.maxSteps ?? null;
  const stepsOk = maxSteps === null || steps <= maxSteps;
  return { ok: missing.length === 0 && forbidden.length === 0 && stepsOk, missing, forbidden, steps, maxSteps };
}

/** Результат одного обращения по всем оценщикам. */
export interface CaseEvaluation {
  id: string;
  fields: FieldReport;
  priority: boolean | null;
  emergency: EmergencyOutcome | null;
  assignee: AssigneeOutcome | null;
  article: boolean | null;
  question: boolean | null;
  trajectory: TrajectoryOutcome | null;
  /** Время на обращение, мс. */
  ms: number;
  /** Стоимость обращения, ₽ (0 — заглушка модели). */
  costRub: number;
  steps: number;
  errors: string[];
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  const left = sorted[middle - 1] ?? 0;
  const right = sorted[middle] ?? 0;
  return (left + right) / 2;
}

export interface EvaluatorSummary {
  key: string;
  title: string;
  /** Доля 0..1 для порогов-процентов, иначе количество. */
  value: number;
  /** Готовая строка для таблицы: «85 %», «2», «1,2 с». */
  display: string;
  /** Эталон: к чему стремимся («100 %», «0», «≤ 8 с»). */
  ideal: string;
  /** Готовое условие порога: «≥ 90 %», «0», «≤ 8 с». */
  threshold: string;
  passed: boolean;
  /** Сколько случаев участвовало в оценке. */
  total: number;
  note?: string;
}

export interface QualitySummary {
  /** Сколько обращений в прогоне. */
  cases: number;
  evaluators: EvaluatorSummary[];
  unmet: EvaluatorSummary[];
  fabricatedTotal: number;
  emergencyMisses: number;
  emergencyFalseAlarms: number;
  /** Сколько шагов прогона закончилось не «ok»: для пустых обращений это единственный признак поломки. */
  failedSteps: number;
  medianMs: number;
  medianCostRub: number;
  /** Сколько оценщиков с порогом выполнено. */
  met: number;
  withThreshold: number;
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)} %`;
}

export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1).replace('.', ',')} с`;
}

export function formatRub(value: number): string {
  return `${value.toFixed(2).replace('.', ',')} ₽`;
}

function share(
  key: string,
  title: string,
  hits: number,
  total: number,
  threshold: number,
  emptyNote = 'нет эталона в наборе',
): EvaluatorSummary {
  if (total === 0) {
    return {
      key,
      title,
      value: 0,
      display: '—',
      ideal: '100 %',
      threshold: `≥ ${formatPercent(threshold)}`,
      passed: true,
      total: 0,
      note: emptyNote,
    };
  }
  const value = hits / total;
  return {
    key,
    title,
    value,
    display: formatPercent(value),
    ideal: '100 %',
    threshold: `≥ ${formatPercent(threshold)}`,
    passed: value >= threshold,
    total,
  };
}

function countIssue(key: string, title: string, value: number, total: number): EvaluatorSummary {
  return {
    key,
    title,
    value,
    display: String(value),
    ideal: '0',
    threshold: '0',
    passed: value <= THRESHOLDS.fabricated,
    total,
  };
}

/** Сводка по всем обращениям: доли, пороги и что не выполнено. */
export function summarize(cases: readonly CaseEvaluation[]): QualitySummary {
  const fieldTotal = cases.reduce((sum, item) => sum + item.fields.total, 0);
  const fieldHits = cases.reduce((sum, item) => sum + item.fields.hits, 0);
  const fabricatedTotal = cases.reduce((sum, item) => sum + item.fields.fabricated.length, 0);

  const priorityCases = cases.filter((item) => item.priority !== null);
  const emergencyCases = cases.filter((item) => item.emergency !== null);
  const assigneeCases = cases.filter((item) => item.assignee !== null);
  const articleCases = cases.filter((item) => item.article !== null);
  const questionCases = cases.filter((item) => item.question !== null);
  const trajectoryCases = cases.filter((item) => item.trajectory !== null);

  const emergencyMisses = emergencyCases.filter((item) => item.emergency?.miss).length;
  const emergencyFalseAlarms = emergencyCases.filter((item) => item.emergency?.falseAlarm).length;

  const hasCost = cases.some((item) => item.costRub > 0);
  const medianMs = median(cases.map((item) => item.ms));
  const medianCostRub = median(cases.map((item) => item.costRub));

  const evaluators: EvaluatorSummary[] = [
    share('fields', 'Поля', fieldHits, fieldTotal, THRESHOLDS.fields),
    countIssue('fabricated', 'Выдуманные поля', fabricatedTotal, cases.length),
    {
      ...countIssue('emergency', 'Авария: пропуски', emergencyMisses, emergencyCases.length),
      note:
        emergencyFalseAlarms > 0
          ? `ложных тревог: ${emergencyFalseAlarms}`
          : emergencyCases.length === 0
            ? 'нет эталона аварии в наборе'
            : undefined,
    },
    share(
      'priority',
      'Приоритет',
      priorityCases.filter((item) => item.priority === true).length,
      priorityCases.length,
      THRESHOLDS.priority,
    ),
    share(
      'assigneeTop1',
      'Исполнитель в топ-1',
      assigneeCases.filter((item) => item.assignee?.top1).length,
      assigneeCases.length,
      THRESHOLDS.assigneeTop1,
    ),
    share(
      'assigneeTop3',
      'Исполнитель в топ-3',
      assigneeCases.filter((item) => item.assignee?.top3).length,
      assigneeCases.length,
      THRESHOLDS.assigneeTop3,
    ),
    share(
      'article',
      'Статья в топ-3',
      articleCases.filter((item) => item.article === true).length,
      articleCases.length,
      THRESHOLDS.article,
    ),
    share(
      'question',
      'Нужный вопрос заявителю',
      questionCases.filter((item) => item.question === true).length,
      questionCases.length,
      THRESHOLDS.question,
      'в наборе нет эталона вопроса (expected.question)',
    ),
    share(
      'trajectory',
      'Траектория агента',
      trajectoryCases.filter((item) => item.trajectory?.ok).length,
      trajectoryCases.length,
      THRESHOLDS.trajectory,
      'в наборе нет эталона траектории (mustCall/mustNotCall/maxSteps)',
    ),
    {
      key: 'time',
      title: 'Время на обращение (медиана)',
      value: medianMs,
      display: formatSeconds(medianMs),
      ideal: `≤ ${THRESHOLDS.seconds} с`,
      threshold: `≤ ${THRESHOLDS.seconds} с`,
      passed: medianMs <= THRESHOLDS.seconds * 1000,
      total: cases.length,
    },
    {
      key: 'price',
      title: 'Цена обращения (медиана)',
      value: medianCostRub,
      display: hasCost ? formatRub(medianCostRub) : '—',
      ideal: `≤ ${formatRub(THRESHOLDS.rub)}`,
      threshold: `≤ ${formatRub(THRESHOLDS.rub)}`,
      passed: !hasCost || medianCostRub <= THRESHOLDS.rub,
      total: cases.length,
      note: hasCost ? undefined : 'заглушка модели: цена не считается',
    },
  ];

  const withThreshold = evaluators.length;
  const unmet = evaluators.filter((item) => !item.passed);
  return {
    cases: cases.length,
    evaluators,
    unmet,
    fabricatedTotal,
    emergencyMisses,
    emergencyFalseAlarms,
    failedSteps: cases.reduce((sum, item) => sum + item.errors.length, 0),
    medianMs,
    medianCostRub,
    met: withThreshold - unmet.length,
    withThreshold,
  };
}
