import { describe, expect, it } from 'vitest';
import type { PipelineStep } from '@ugra/core';
import { assertModuleContract, runModuleContract } from '@ugra/testkit';
import applicantFeedback from '../server';

/**
 * Тест-контракт проверяет один модуль, а `fields` пишет другой модуль (`extraction`).
 * Подставляем фиктивного писателя полей с префиксом `applicant-feedback.` — сам модуль не меняется.
 */
const fieldsWriter: PipelineStep = {
  id: 'applicant-feedback.fixture-fields',
  title: 'Фикстура теста: поля пишет модуль extraction',
  stage: 'extract',
  order: 100,
  reads: ['sources'],
  writes: ['fields'],
  async run() {
    return {};
  },
};

const contractModule = { ...applicantFeedback, steps: [fieldsWriter, ...applicantFeedback.steps] };

describe('тест-контракт модуля applicant-feedback', () => {
  it('проходит контракт', async () => {
    await assertModuleContract(contractModule, {
      readmePath: 'modules/applicant-feedback/README.md',
    });
  });

  it('проходит сквозной прогон и выключение модуля', async () => {
    const { draft } = await runModuleContract({ modules: [applicantFeedback] });

    expect(draft.replyDraft?.text).toContain('Заявка');
    expect(draft.replyDraft?.template).toBe(true);
  });
});
