import { describe, expect, it } from 'vitest';
import type { AppealMessage } from '@ugra/contracts';
import { aiQuestionsOf, orderByPlan, planFromHistory, questionCard } from '../server/question';

const urgency = {
  fieldKey: 'urgency',
  question: 'Принтер в 312 встал — договоры ждут?',
  options: ['down', 'degraded'],
};
const impact = {
  fieldKey: 'impact',
  question: 'Не печатает только у вас или у всего кабинета?',
  options: [],
};

function card(plan: unknown, id = 'm-1'): AppealMessage {
  return {
    id,
    appealId: 'a-1',
    direction: 'out',
    kind: 'question_card',
    body: 'вопрос',
    fieldKey: 'urgency',
    card: { cardType: 'question', payload: { plan } },
    createdAt: '2026-11-14T10:00:00.000Z',
  };
}

describe('план вопросов модели', () => {
  it('читает список questions из разбора', () => {
    expect(aiQuestionsOf({ extraction: { questions: [urgency, impact] } })).toEqual([urgency, impact]);
  });

  it('без списка берёт старый одиночный clarify', () => {
    expect(aiQuestionsOf({ extraction: { clarify: impact } })).toEqual([impact]);
  });

  it('отбрасывает битые вопросы и пустые варианты', () => {
    const plan = aiQuestionsOf({
      extraction: {
        questions: [
          { fieldKey: '', question: 'x' },
          { ...urgency, options: ['down', ' ', 7] },
        ],
      },
    });
    expect(plan).toEqual([{ ...urgency, options: ['down'] }]);
  });

  it('без разбора — пустой план', () => {
    expect(aiQuestionsOf(undefined)).toEqual([]);
  });

  it('после ответа достаёт план из первой карточки истории', () => {
    const answer: AppealMessage = { ...card([]), id: 'm-0', kind: 'answer', direction: 'in' };
    expect(planFromHistory([answer, card([urgency, impact]), card([], 'm-2')])).toEqual([urgency, impact]);
  });

  it('история без плана — пустой план', () => {
    expect(planFromHistory([card('не список')])).toEqual([]);
  });

  it('сортирует недостающие поля по плану, остальные — в конце по реестру', () => {
    const missing = [{ key: 'cabinet' }, { key: 'impact' }, { key: 'symptoms' }, { key: 'urgency' }];
    expect(orderByPlan(missing, [urgency, impact]).map((item) => item.key)).toEqual([
      'urgency',
      'impact',
      'cabinet',
      'symptoms',
    ]);
  });

  it('карточка хранит план для следующих раундов', () => {
    const stored = questionCard(
      {
        key: 'urgency',
        label: 'Срочность',
        question: urgency.question,
        widget: 'buttons',
        source: 'ai',
        allowUnknown: true,
        allowFreeText: true,
      },
      [urgency],
    );
    expect(stored.payload.plan).toEqual([urgency]);
  });
});
