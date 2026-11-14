import type { FieldValue } from '@ugra/contracts';
import type { PipelineStep, StepContext } from '@ugra/core';
import { defineModule, findField } from '@ugra/core';
import { PREFILL_STEP_ID, prefillFromProfile } from './prefill';

/** Каждое подставленное поле видно в интерфейсе со значком «из профиля». */
function reportFields(ctx: StepContext, fields: Record<string, FieldValue>): void {
  for (const field of Object.values(fields)) {
    const label = findField(ctx.data, field.key)?.label ?? field.key;
    ctx.progress({
      stepId: PREFILL_STEP_ID,
      status: 'progress',
      fields: [field.key],
      message: `${label}: ${String(field.value)} — из профиля`,
    });
  }
}

/** Шаг `profile.prefill`: место и техника из профиля заявителя, если текст их не назвал. */
const prefillStep: PipelineStep = {
  id: PREFILL_STEP_ID,
  title: 'Подставляем место и технику из профиля',
  stage: 'validate',
  // После проверки цитат (extraction.ground, order 100), до поиска недостающих полей.
  order: 150,
  reads: ['fields'],
  writes: ['fields'],
  async run(ctx) {
    const fields = await prefillFromProfile(ctx);
    reportFields(ctx, fields);
    return { fields };
  },
  async fallback() {
    // Профиль — подсказка, а не обязательный шаг: без него заявителю просто зададут вопросы.
    return {};
  },
};

export default defineModule({
  id: 'applicant-profile',
  title: 'Профиль заявителя',
  enabledByDefault: true,
  steps: [prefillStep],
});
