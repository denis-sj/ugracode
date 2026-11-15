import { describe, expect, it } from 'vitest';
import type { DictionaryItem, FieldDef } from '@ugra/contracts';
import {
  CHAT_EXAMPLES,
  buildAiSummary,
  buildQuestions,
  clampIndex,
  dictionaryLabel,
  dictionaryOptions,
  fieldValues,
  ownAnswer,
  parseEmphasis,
  questionsFor,
  questionCounter,
  stickerRows,
  ticketTitle,
  type FieldValues,
} from '../../../modules/clarify-chat/web/format';

function field(overrides: Partial<FieldDef>): FieldDef {
  return {
    key: 'field',
    label: 'Поле',
    group: 'location',
    type: 'string',
    required: true,
    extractHint: 'из текста',
    evalMode: 'none',
    ...overrides,
  };
}

function dictionaryItem(dictionary: string, code: string, label: string): DictionaryItem {
  return { dictionary, code, label };
}

const buildingAsk = {
  question: 'В каком корпусе это находится?',
  widget: 'buttons' as const,
  optionsFrom: 'building',
};
const buildings = [
  dictionaryItem('building', 'А', 'Корпус А'),
  dictionaryItem('building', 'Б', 'Корпус Б'),
  dictionaryItem('building', 'В', 'Корпус В'),
  dictionaryItem('building', 'ПРОМ', 'Промплощадка'),
];

describe('dictionaryOptions', () => {
  it('берёт значения нужного справочника по порядку', () => {
    expect(dictionaryOptions(buildings, 'building').map((option) => option.value)).toEqual([
      'А',
      'Б',
      'В',
      'ПРОМ',
    ]);
  });

  it('без справочника — пусто', () => {
    expect(dictionaryOptions(buildings, undefined)).toEqual([]);
    expect(dictionaryOptions(buildings, 'unknown')).toEqual([]);
  });
});

describe('dictionaryLabel', () => {
  it('переводит код в подпись, неизвестный код оставляет как есть', () => {
    expect(dictionaryLabel(buildings, 'building', 'Б')).toBe('Корпус Б');
    expect(dictionaryLabel(buildings, 'building', 'Г')).toBe('Г');
    expect(dictionaryLabel(buildings, 'building', null)).toBeNull();
  });
});

describe('buildQuestions', () => {
  const fields: FieldDef[] = [
    field({ key: 'object', label: 'Объект', ask: { question: 'Что не работает?', widget: 'text' } }),
    field({ key: 'building', label: 'Корпус', type: 'dictionary', dictionary: 'building', ask: buildingAsk }),
    field({ key: 'floor', label: 'Этаж', required: false, ask: { question: 'Этаж?', widget: 'text' } }),
    field({
      key: 'symptoms',
      label: 'Симптомы',
      type: 'text',
      ask: { question: 'Что происходит?', widget: 'text' },
    }),
  ];

  it('спрашивает только пустые обязательные поля с готовым вопросом', () => {
    const values: FieldValues = {
      object: { value: 'Принтер' },
      symptoms: { value: 'не печатает' },
    };
    expect(buildQuestions(fields, buildings, values).map((question) => question.key)).toEqual(['building']);
  });

  it('не больше трёх вариантов и коды справочника как значения', () => {
    const question = buildQuestions(fields, buildings, {}).find((item) => item.key === 'building');
    expect(question?.options.map((option) => option.label)).toEqual(['Корпус А', 'Корпус Б', 'Корпус В']);
    expect(question?.options.map((option) => option.value)).toEqual(['А', 'Б', 'В']);
  });

  it('подписывает вариант, совпавший с полем из профиля', () => {
    const withKnown = [
      ...fields,
      field({ key: 'knownBuilding', label: 'Корпус из профиля', required: false }),
    ];
    const values: FieldValues = { knownBuilding: { value: 'Б', origin: 'profile' } };
    const question = buildQuestions(withKnown, buildings, values).find((item) => item.key === 'building');
    expect(question?.options.find((option) => option.value === 'Б')?.hint).toBe('Указан в вашем профиле');
  });

  it('не спрашивает повторно поля, на которые уже ответили, в том числе «не знаю»', () => {
    const answered = new Set(['building']);
    expect(buildQuestions(fields, buildings, {}, answered).map((question) => question.key)).not.toContain(
      'building',
    );
  });

  it('не спрашивает поле «на проверку» без вариантов — его проверит диспетчер', () => {
    const emptyish = [
      field({
        key: 'equipment',
        label: 'Оборудование',
        type: 'cmdbRef',
        ask: { question: 'Какое оборудование?', widget: 'select' },
      }),
    ];
    const values: FieldValues = { equipment: { value: 'HP M428', origin: 'text', needsReview: true } };
    expect(buildQuestions(emptyish, [], values).map((question) => question.key)).toEqual([]);
  });

  it('спрашивает поле «на проверку» и первым предлагает текущий вариант', () => {
    const withImpact = [
      ...fields,
      field({
        key: 'impact',
        label: 'Влияние',
        type: 'dictionary',
        dictionary: 'impact',
        ask: { question: 'Сколько сотрудников затронуто?', widget: 'buttons', optionsFrom: 'impact' },
      }),
    ];
    const impactDictionary = [
      dictionaryItem('impact', 'one', 'Один сотрудник'),
      dictionaryItem('impact', 'group', 'Группа сотрудников'),
      dictionaryItem('impact', 'building', 'Корпус'),
    ];
    const values: FieldValues = { impact: { value: 'group', origin: 'text', needsReview: true } };
    const question = buildQuestions(withImpact, impactDictionary, values).find(
      (item) => item.key === 'impact',
    );
    expect(question?.options[0]).toEqual({
      value: 'group',
      label: 'Группа сотрудников',
      hint: 'ИИ предлагает — подтвердите',
    });
  });

  it('пустой реестр и всё заполнено — вопросов нет', () => {
    expect(buildQuestions([], buildings, {})).toEqual([]);
    const filled: FieldValues = { building: { value: 'А' } };
    expect(
      buildQuestions(
        fields.filter((item) => item.key === 'building'),
        buildings,
        filled,
      ),
    ).toEqual([]);
  });
});

describe('questionsFor', () => {
  const fieldsMeta: FieldDef[] = [
    field({ key: 'impact', label: 'Влияние', type: 'dictionary', dictionary: 'impact', ask: {
      question: 'Сколько сотрудников затронуто?',
      widget: 'buttons',
      optionsFrom: 'impact',
    } }),
  ];
  const impacts = [
    dictionaryItem('impact', 'one', 'Один сотрудник'),
    dictionaryItem('impact', 'group', 'Группа сотрудников'),
    dictionaryItem('impact', 'building', 'Корпус'),
  ];

  it('варианты модели идут первыми, справочник добирает до трёх', () => {
    const [question] = questionsFor({
      fields: fieldsMeta,
      dictionaries: impacts,
      values: {},
      analysis: {
        emergency: null,
        missing: [
          {
            key: 'impact',
            label: 'Влияние',
            question: 'Сколько сотрудников затронуто?',
            options: [{ value: 'one', label: 'Один сотрудник' }],
          },
        ],
      },
    });
    expect(question?.options.map((option) => option.label)).toEqual([
      'Один сотрудник',
      'Группа сотрудников',
      'Корпус',
    ]);
  });

  it('карточка без вариантов не остаётся: справочник заполняет её целиком', () => {
    const [question] = questionsFor({
      fields: fieldsMeta,
      dictionaries: impacts,
      values: {},
      analysis: {
        emergency: null,
        missing: [{ key: 'impact', label: 'Влияние', question: 'Сколько?', options: [] }],
      },
    });
    expect(question?.options).toHaveLength(3);
  });
});

describe('ownAnswer', () => {
  it('обрезает пробелы, пустое — не ответ', () => {
    expect(ownAnswer('  корпус Г  ')).toBe('корпус Г');
    expect(ownAnswer('   ')).toBeNull();
  });
});

describe('parseEmphasis', () => {
  it('разбирает жирные фрагменты', () => {
    expect(parseEmphasis('Поняла: **принтер** в **312** кабинете')).toEqual([
      { text: 'Поняла: ', strong: false },
      { text: 'принтер', strong: true },
      { text: ' в ', strong: false },
      { text: '312', strong: true },
      { text: ' кабинете', strong: false },
    ]);
  });

  it('обычный текст и пустая строка', () => {
    expect(parseEmphasis('просто текст')).toEqual([{ text: 'просто текст', strong: false }]);
    expect(parseEmphasis('')).toEqual([]);
  });
});

describe('buildAiSummary', () => {
  const fieldsMeta: FieldDef[] = [];

  it('собирает фразу из полей заявки и выделяет ключевое жирным', () => {
    const values: FieldValues = {
      model: { value: 'HP LaserJet M428' },
      building: { value: 'Б' },
      cabinet: { value: '312' },
      symptoms: { value: 'горит оранжевая лампочка' },
    };
    const summary = buildAiSummary({ fields: values, fieldsMeta, dictionaries: buildings });
    expect(summary).toContain('**HP LaserJet M428**');
    expect(summary).toContain('**в кабинете 312, корпус Б**');
    expect(summary).toContain('**горит оранжевая лампочка**');
    expect(parseEmphasis(summary).some((segment) => segment.strong)).toBe(true);
  });

  it('без данных — честный текст без выдуманных номеров', () => {
    expect(buildAiSummary({ fields: {}, fieldsMeta, dictionaries: buildings })).toContain('заявка справа');
  });

  it('хвост фразы зависит от числа оставшихся вопросов', () => {
    const base = { fields: { cabinet: { value: '312' } }, fieldsMeta, dictionaries: buildings };
    expect(buildAiSummary({ ...base, questions: 0 })).toContain('Заявка собрана');
    expect(buildAiSummary({ ...base, questions: 1 })).toContain('Один вопрос');
    expect(buildAiSummary({ ...base, questions: 3 })).toContain('Ещё 3 вопроса');
  });
});

describe('ticketTitle', () => {
  const fieldsMeta: FieldDef[] = [];

  it('симптом → объект → категория', () => {
    expect(
      ticketTitle({ fields: { symptoms: { value: 'не печатает' } }, fieldsMeta, dictionaries: [] }),
    ).toBe('Не печатает');
    expect(ticketTitle({ fields: { object: { value: 'Принтер' } }, fieldsMeta, dictionaries: [] })).toBe(
      'Принтер',
    );
    expect(
      ticketTitle({
        fields: { category: { value: 'printer' } },
        fieldsMeta,
        dictionaries: [dictionaryItem('category', 'printer', 'Принтер и печать')],
      }),
    ).toBe('Принтер и печать');
    expect(ticketTitle({ fields: {}, fieldsMeta, dictionaries: [] })).toBe('Обращение');
  });

  it('длинный симптом обрезается', () => {
    const long = 'а'.repeat(100);
    expect(ticketTitle({ fields: { symptoms: { value: long } }, fieldsMeta, dictionaries: [] })).toHaveLength(
      79,
    );
  });
});

describe('stickerRows', () => {
  const fieldsMeta: FieldDef[] = [];

  it('заполняет строки и добавляет инженера со сроком', () => {
    const values: FieldValues = {
      model: { value: 'HP M428' },
      building: { value: 'Б' },
      cabinet: { value: '312' },
      symptoms: { value: 'горит лампочка' },
      urgency: { value: 'stop' },
    };
    const rows = stickerRows({
      fields: values,
      fieldsMeta,
      dictionaries: [...buildings, dictionaryItem('urgency', 'stop', 'Работа остановлена')],
      assigneeName: 'Петров С. В.',
      due: 'сегодня до 14:30',
    });
    expect(rows.map((row) => row.key)).toEqual(['equipment', 'place', 'symptom', 'urgency', 'assignee']);
    expect(rows[1]?.value).toBe('кабинет 312, корпус Б');
    expect(rows[3]?.value).toBe('Работа остановлена');
    expect(rows[4]?.value).toBe('Петров С. В., сегодня до 14:30');
  });

  it('подписывает происхождение значения под строкой', () => {
    const values: FieldValues = {
      model: { value: 'HP M428' },
      building: { value: 'Б' },
      cabinet: { value: '312' },
      symptoms: { value: 'горит лампочка' },
      urgency: { value: 'stop' },
    };
    const rows = stickerRows({
      fields: values,
      fieldsMeta,
      dictionaries: [...buildings, dictionaryItem('urgency', 'stop', 'Работа остановлена')],
      origins: { model: 'text', cabinet: 'profile', urgency: 'text' },
    });
    expect(rows.find((row) => row.key === 'equipment')?.source).toEqual({
      text: 'из вашего текста',
      tone: 'accent',
    });
    expect(rows.find((row) => row.key === 'place')?.source).toEqual({ text: 'из профиля', tone: 'accent' });
    expect(rows.find((row) => row.key === 'assignee')?.source).toBeUndefined();
  });

  it('ожидающие поля просят ответ, а не молчат', () => {
    const rows = stickerRows({ fields: {}, fieldsMeta, dictionaries: buildings });
    expect(rows.find((row) => row.key === 'place')?.source).toEqual({ text: 'ждём ваш ответ', tone: 'warn' });
  });

  it('пустые поля ждут, «не знаю» — уточнит диспетчер', () => {
    const rows = stickerRows({
      fields: { building: { value: null } },
      fieldsMeta,
      dictionaries: buildings,
      answers: { building: null },
    });
    expect(rows.find((row) => row.key === 'place')?.value).toBe('уточнит диспетчер');
    expect(rows.find((row) => row.key === 'equipment')?.value).toBe('уточняем…');
  });
});

describe('fieldValues', () => {
  it('накладывает ответы чата поверх серверных полей', () => {
    const values = fieldValues(
      [
        {
          ticketId: 't-1',
          fieldKey: 'building',
          value: 'А',
          confidence: 0.9,
          quote: null,
          origin: 'text',
          needsReview: false,
          trace: [],
          aiValue: 'А',
        },
      ],
      { building: 'Б', cabinet: '312' },
    );
    expect(values.building).toEqual({ value: 'Б', origin: 'asked', needsReview: false });
    expect(values.cabinet).toEqual({ value: '312', origin: 'asked', needsReview: false });
  });
});

describe('questionCounter и clampIndex', () => {
  it('показывает «1 из N» и не выходит за границы', () => {
    expect(questionCounter(0, 2)).toBe('1 из 2');
    expect(questionCounter(5, 2)).toBe('2 из 2');
    expect(questionCounter(0, 0)).toBe('0 из 0');
    expect(clampIndex(0, 2)).toBe(0);
    expect(clampIndex(-1, 2)).toBe(1);
    expect(clampIndex(2, 2)).toBe(0);
    expect(clampIndex(3, 0)).toBe(0);
  });
});

describe('CHAT_EXAMPLES', () => {
  it('три живых примера с короткой подписью и подробным текстом', () => {
    expect(CHAT_EXAMPLES).toHaveLength(3);
    for (const example of CHAT_EXAMPLES) {
      expect(example.label.length).toBeLessThanOrEqual(26);
      expect(example.text.length).toBeGreaterThan(example.label.length * 2);
    }
  });
});
