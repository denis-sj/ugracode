import { describe, expect, it } from 'vitest';
import type { DictionaryItem, FieldDef, RunStreamEvent } from '@ugra/contracts';
import {
  emergencyBadge,
  initialRunProgress,
  parseAnalysis,
  questionsFor,
  reduceRunEvent,
  stickerRows,
  type AnalysisView,
  type FieldValues,
  type RunProgressView,
} from '../../../modules/clarify-chat/web/format';

function event(
  type: RunStreamEvent['type'],
  stepId?: string,
  message?: string,
): RunStreamEvent {
  return {
    type,
    runId: 'run-1',
    appealId: 'appeal-1',
    ...(stepId ? { stepId } : {}),
    ...(message ? { message } : {}),
  };
}

const fields: readonly FieldDef[] = [
  {
    key: 'building',
    label: 'Корпус',
    group: 'location',
    type: 'dictionary',
    dictionary: 'building',
    required: true,
    extractHint: 'из текста',
    ask: { question: 'В каком корпусе?', widget: 'buttons', optionsFrom: 'building' },
    evalMode: 'none',
  },
  {
    key: 'cabinet',
    label: 'Кабинет',
    group: 'location',
    type: 'string',
    required: true,
    extractHint: 'из текста',
    ask: { question: 'Какой кабинет?', widget: 'text' },
    evalMode: 'none',
  },
];

const dictionaries: readonly DictionaryItem[] = [
  { dictionary: 'building', code: 'А', label: 'Корпус А' },
  { dictionary: 'building', code: 'Б', label: 'Корпус Б' },
];

const values: FieldValues = {};

function analysisWithMissing(): AnalysisView {
  return {
    missing: [
      { key: 'cabinet', label: 'Кабинет', question: 'В каком кабинете?', options: [] },
      {
        key: 'building',
        label: 'Корпус',
        question: 'В каком корпусе находится кабинет?',
        options: [
          { value: 'А', label: 'Корпус А' },
          { value: 'Б', label: 'Корпус Б' },
          { value: 'В', label: 'Корпус В' },
          { value: 'ПРОМ', label: 'Промплощадка' },
        ],
      },
    ],
    emergency: null,
  };
}

describe('reduceRunEvent', () => {
  it('добавляет шаг, обновляет подпись и закрывает его', () => {
    let state = initialRunProgress();
    state = reduceRunEvent(state, event('step.started', 'agent.intake'));
    expect(state.steps).toHaveLength(1);
    expect(state.steps[0]?.label).toBe('Разбираем обращение');
    expect(state.current).toBe('Разбираем обращение');

    state = reduceRunEvent(state, event('step.progress', 'agent.intake', 'Нашли принтер'));
    expect(state.steps[0]?.status).toBe('progress');
    expect(state.steps[0]?.message).toBe('Нашли принтер');
    expect(state.current).toBe('Нашли принтер');

    state = reduceRunEvent(state, event('step.completed', 'agent.intake'));
    expect(state.steps[0]?.status).toBe('completed');
    expect(state.current).toBeNull();
  });

  it('не дублирует шаг, если история пришла повторно', () => {
    let state = initialRunProgress();
    state = reduceRunEvent(state, event('step.started', 'priority.compute'));
    state = reduceRunEvent(state, event('step.started', 'priority.compute'));
    state = reduceRunEvent(state, event('step.completed', 'priority.compute'));
    expect(state.steps).toHaveLength(1);
    expect(state.steps[0]?.status).toBe('completed');
  });

  it('сохраняет порядок шагов и показывает новый последним', () => {
    const state = ['intake.normalize', 'agent.intake', 'finalize'].reduce<RunProgressView>(
      (current, stepId) => reduceRunEvent(current, event('step.started', stepId)),
      initialRunProgress(),
    );
    expect(state.steps.map((step) => step.label)).toEqual([
      'Собираем текст обращения',
      'Разбираем обращение',
      'Готовим итог разбора',
    ]);
  });

  it('завершает разбор успешно и с ошибкой', () => {
    const done = reduceRunEvent(initialRunProgress(), event('run.completed'));
    expect(done.finished).toBe(true);
    expect(done.failed).toBe(false);
    expect(done.current).toBeNull();

    const failed = reduceRunEvent(initialRunProgress(), event('run.failed'));
    expect(failed.finished).toBe(true);
    expect(failed.failed).toBe(true);
  });

  it('неизвестный тип события и пустой stepId ничего не меняют', () => {
    const state = reduceRunEvent(initialRunProgress(), event('step.started', 'agent.intake'));
    const unknown = { ...event('run.completed'), type: 'agent.step' } as unknown as RunStreamEvent;
    expect(reduceRunEvent(state, unknown)).toBe(state);
    expect(reduceRunEvent(state, event('step.progress'))).toBe(state);
  });
});

describe('parseAnalysis', () => {
  it('читает missing и аварию', () => {
    const parsed = parseAnalysis({
      missing: [{ key: 'cabinet', label: 'Кабинет', question: 'Какой кабинет?', options: [{ value: '312', label: '312' }] }],
      emergency: { level: 'confirmed', confidence: 1.7, signs: [{ sign: 'smoke', quote: 'идёт дым' }] },
    });
    expect(parsed.missing).toHaveLength(1);
    expect(parsed.missing[0]?.options[0]).toEqual({ value: '312', label: '312' });
    expect(parsed.emergency).toEqual({ level: 'confirmed', confidence: 1, signs: ['идёт дым'] });
  });

  it('переживает мусор и неизвестный уровень аварии', () => {
    expect(parseAnalysis(null)).toEqual({ missing: [], emergency: null });
    expect(parseAnalysis({ missing: 'нет', emergency: { level: 'none' } })).toEqual({
      missing: [],
      emergency: null,
    });
    expect(parseAnalysis({ missing: [{ key: 42 }, null] }).missing).toEqual([]);
    expect(parseAnalysis({}).emergency).toBeNull();
  });
});

describe('emergencyBadge', () => {
  it('показывает уровень и уверенность в процентах', () => {
    expect(
      emergencyBadge({ missing: [], emergency: { level: 'confirmed', confidence: 0.97, signs: ['идёт дым'] } }),
    ).toEqual({ text: 'Авария · 97%', title: 'Авария · 97%. Признак: «идёт дым»' });
    expect(
      emergencyBadge({ missing: [], emergency: { level: 'suspected', confidence: 0.8, signs: [] } })?.text,
    ).toBe('Возможна авария · 80%');
  });

  it('без аварии плашки нет', () => {
    expect(emergencyBadge(null)).toBeNull();
    expect(emergencyBadge({ missing: [], emergency: null })).toBeNull();
  });
});

describe('questionsFor', () => {
  it('берёт вопросы из missing: формулировка и порядок сервера, не больше трёх вариантов', () => {
    const questions = questionsFor({
      fields,
      dictionaries,
      values,
      analysis: analysisWithMissing(),
    });
    expect(questions.map((question) => question.key)).toEqual(['cabinet', 'building']);
    expect(questions[1]?.question).toBe('В каком корпусе находится кабинет?');
    expect(questions[1]?.options).toHaveLength(3);
  });

  it('не повторяет вопросы, на которые уже ответили', () => {
    const questions = questionsFor({
      fields,
      dictionaries,
      values,
      answered: new Set(['cabinet']),
      analysis: analysisWithMissing(),
    });
    expect(questions.map((question) => question.key)).toEqual(['building']);
  });

  it('если missing есть, но всё отвечено — к шаблонам не откатывается', () => {
    const questions = questionsFor({
      fields,
      dictionaries,
      values,
      answered: new Set(['cabinet', 'building']),
      analysis: analysisWithMissing(),
    });
    expect(questions).toEqual([]);
  });

  it('без missing собирает вопросы из реестра полей', () => {
    const questions = questionsFor({ fields, dictionaries, values, analysis: { missing: [], emergency: null } });
    expect(questions.map((question) => question.key)).toEqual(['building', 'cabinet']);
    expect(questions[0]?.options.map((option) => option.value)).toEqual(['А', 'Б']);
  });

  it('битый missing не ломает экран — работает реестр', () => {
    const questions = questionsFor({
      fields,
      dictionaries,
      values,
      analysis: parseAnalysis({ missing: [{ key: 'building' }] }),
    });
    expect(questions.map((question) => question.key)).toEqual(['building', 'cabinet']);
  });
});

describe('стикер обновляется по ответам', () => {
  it('пустое поле ждёт, ответ «не знаю» уходит диспетчеру', () => {
    const waiting = stickerRows({ fields: {}, fieldsMeta: fields, dictionaries });
    expect(waiting.find((row) => row.key === 'place')?.value).toBe('уточняем…');

    const unknown = stickerRows({
      fields: {},
      fieldsMeta: fields,
      dictionaries,
      answers: { cabinet: null },
    });
    expect(unknown.find((row) => row.key === 'place')?.value).toBe('уточнит диспетчер');
  });

  it('ответ заявителя сразу виден в стикере', () => {
    const filled = stickerRows({
      fields: {
        cabinet: { value: '312', origin: 'asked' },
        building: { value: 'Б', origin: 'asked' },
      },
      fieldsMeta: fields,
      dictionaries,
    });
    expect(filled.find((row) => row.key === 'place')?.value).toBe('кабинет 312, корпус Б');
    expect(filled.find((row) => row.key === 'place')?.tone).toBe('ok');
  });
});
