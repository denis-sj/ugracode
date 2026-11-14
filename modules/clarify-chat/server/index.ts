import type { PipelineStep } from '@ugra/core';
import { defineModule } from '@ugra/core';
import { CLARIFY_STEP_ID, clarifyMissing } from './clarify';

/** Шаг `clarify.missing`: недостающие обязательные поля → одна карточка-вопрос в чат. */
const clarifyStep: PipelineStep = {
  id: CLARIFY_STEP_ID,
  title: 'Спрашиваем недостающие поля карточкой',
  stage: 'validate',
  // После проверки цитат и профиля (order 100 и 150), до оценки аварии и приоритета.
  order: 200,
  reads: ['fields', 'missing'],
  writes: ['missing', 'ext'],
  async run(ctx) {
    return clarifyMissing(ctx);
  },
  async fallback() {
    // Чат — подсказка: без него заявка всё равно собирается и уходит диспетчеру.
    return {};
  },
};

export default defineModule({
  id: 'clarify-chat',
  title: 'Уточнения в чате',
  enabledByDefault: true,
  steps: [clarifyStep],
  /** Своих данных модуль не заводит: история чата — таблица ядра `appeal_message`. */
  async seed() {
    return Promise.resolve();
  },
});
