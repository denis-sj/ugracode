import { describe, expect, it } from 'vitest';
import type { DictionaryItem, FieldDef, MetaResponse, RunStreamEvent, StepRun, TicketField } from '@ugra/contracts';
import { fieldDrafts, missingQuestions, stepsFromEvents, stepsFromRuns, stepTitle } from '../../../modules/clarify-chat/web/analysis';

function fieldDef(overrides: Partial<FieldDef> & Pick<FieldDef, 'key' | 'label'>): FieldDef {
  return {
    group: 'location',
    type: 'string',
    required: false,
    extractHint: 'из текста',
    evalMode: 'none',
    ...overrides,
  };
}

function meta(fields: FieldDef[], dictionaries: DictionaryItem[] = []): MetaResponse {
  return { modules: [], fields, dictionaries, aiMode: 'stub', roles: [], priorities: [] };
}

function ticketField(key: string, value: string | null, overrides: Partial<TicketField> = {}): TicketField {
  return {
    ticketId: 't-1',
    fieldKey: key,
    value,
    confidence: 0.82,
    quote: null,
    origin: 'text',
    needsReview: false,
    trace: [],
    aiValue: value,
    ...overrides,
  };
}

function stepRun(stepId: string, status: StepRun['status'], durationMs = 12): StepRun {
  return { runId: 'r-1', stepId, stage: 'extract', status, durationMs };
}

describe('stepsFromRuns', () => {
  it('на пустом прогоне шагов нет', () => {
    expect(stepsFromRuns([])).toEqual([]);
  });

  it('переводит статусы и знает человеческие названия', () => {
    const steps = stepsFromRuns([stepRun('intake.normalize', 'ok'), stepRun('custom.step', 'timeout', 500)]);
    expect(steps).toHaveLength(2);
    expect(steps[0]?.title).toBe('Читаем обращение');
    expect(steps[0]?.status).toBe('done');
    expect(steps[1]?.title).toBe('Разбор обращения');
    expect(steps[1]?.status).toBe('failed');
    expect(steps[1]?.hint).toContain('500');
  });

  it('не повторяет шаг, если он записан дважды', () => {
    expect(stepsFromRuns([stepRun('finalize', 'ok'), stepRun('finalize', 'ok')])).toHaveLength(1);
  });

  it('неизвестный шаг получает нейтральное название', () => {
    expect(stepTitle('unknown.step')).toBe('Разбор обращения');
  });
});

describe('stepsFromEvents', () => {
  const event = (type: RunStreamEvent['type'], stepId?: string): RunStreamEvent => ({
    type,
    runId: 'r-1',
    appealId: 'a-1',
    stepId,
  });

  it('на пустом потоке шагов нет', () => {
    expect(stepsFromEvents([])).toEqual([]);
  });

  it('собирает шаги из started/completed', () => {
    const steps = stepsFromEvents([
      event('step.started', 'extraction.fields'),
      event('step.completed', 'extraction.fields'),
      event('step.started', 'priority.compute'),
      event('run.completed'),
    ]);
    expect(steps).toHaveLength(2);
    expect(steps[0]?.status).toBe('done');
    expect(steps[1]?.status).toBe('active');
  });

  it('шаг с ошибкой помечается failed', () => {
    const steps = stepsFromEvents([{ ...event('step.completed', 'extraction.fields'), status: 'failed' }]);
    expect(steps[0]?.status).toBe('failed');
  });
});

describe('fieldDrafts', () => {
  it('на пустом реестре полей нет', () => {
    expect(fieldDrafts([ticketField('building', 'А')], meta([]))).toEqual([]);
  });

  it('подставляет подписи справочников и сохраняет порядок реестра', () => {
    const drafts = fieldDrafts(
      [ticketField('building', 'А'), ticketField('cabinet', '312')],
      meta(
        [
          fieldDef({ key: 'building', label: 'Корпус', type: 'dictionary', dictionary: 'building' }),
          fieldDef({ key: 'cabinet', label: 'Кабинет' }),
        ],
        [{ dictionary: 'building', code: 'А', label: 'Корпус А' }],
      ),
    );
    expect(drafts.map((draft) => draft.value)).toEqual(['Корпус А', '312']);
    expect(drafts[0]?.confidence).toBe(0.82);
  });

  it('незаполненное поле остаётся пустым и не ломает разбор', () => {
    const drafts = fieldDrafts([], meta([fieldDef({ key: 'cabinet', label: 'Кабинет' })]));
    expect(drafts[0]?.value).toBeNull();
    expect(drafts[0]?.origin).toBe('none');
  });
});

describe('missingQuestions', () => {
  it('без реестра вопросов нет', () => {
    expect(missingQuestions([], meta([]))).toEqual([]);
  });

  it('спрашивает только пустые обязательные поля', () => {
    const questions = missingQuestions(
      [ticketField('building', 'А')],
      meta([
        fieldDef({ key: 'building', label: 'Корпус', required: true }),
        fieldDef({
          key: 'cabinet',
          label: 'Кабинет',
          required: true,
          ask: { question: 'Укажите номер кабинета', widget: 'text' },
        }),
        fieldDef({ key: 'note', label: 'Заметка', required: false }),
      ]),
    );
    expect(questions.map((question) => question.key)).toEqual(['cabinet']);
    expect(questions[0]?.question).toBe('Укажите номер кабинета');
    expect(questions[0]?.allowUnknown).toBe(true);
    expect(questions[0]?.allowFreeText).toBe(true);
    expect(questions[0]?.source).toBe('template');
  });

  it('для справочника отдаёт проверенные варианты', () => {
    const questions = missingQuestions(
      [],
      meta(
        [
          fieldDef({
            key: 'building',
            label: 'Корпус',
            type: 'dictionary',
            dictionary: 'building',
            required: true,
            ask: { question: 'В каком корпусе?', widget: 'buttons', optionsFrom: 'building' },
          }),
        ],
        [
          { dictionary: 'building', code: 'А', label: 'Корпус А' },
          { dictionary: 'building', code: 'Б', label: 'Корпус Б' },
        ],
      ),
    );
    expect(questions[0]?.options).toEqual([
      { value: 'А', label: 'Корпус А', validated: true },
      { value: 'Б', label: 'Корпус Б', validated: true },
    ]);
  });

  it('условное обязательное поле спрашивается только для своей категории', () => {
    const fields = [
      fieldDef({
        key: 'inventory',
        label: 'Инвентарный номер',
        required: { whenCategory: ['printer'] },
      }),
    ];
    expect(missingQuestions([ticketField('category', 'network')], meta(fields))).toEqual([]);
    expect(missingQuestions([ticketField('category', 'printer')], meta(fields))).toHaveLength(1);
  });
});
