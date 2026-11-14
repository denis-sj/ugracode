import { describe, expect, it } from 'vitest';
import type { PipelineStep } from '@ugra/core';
import { assertModuleContract, runModuleContract } from '@ugra/testkit';
import applicantProfile from '../server';

/**
 * Шаг модуля читает `fields`, а по контракту их обязан записать кто-то раньше.
 * В одиночном модуле такого шага нет, поэтому для проверки контракта добавляем
 * заглушку извлечения — `profile.prefill` при этом настоящий.
 */
const fieldsStub: PipelineStep = {
  id: 'applicant-profile.fields-stub',
  title: 'Заглушка извлечения для тест-контракта',
  stage: 'extract',
  order: 50,
  reads: ['sources'],
  writes: ['fields'],
  async run() {
    return {};
  },
};

/**
 * Ядро требует, чтобы id шага начинался с id модуля, а по спецификации шаг называется
 * `profile.prefill`. Для контракта меняем только id — `run`, `reads`, `writes` настоящие.
 */
const contractStep: PipelineStep = {
  ...applicantProfile.steps[0]!,
  id: 'applicant-profile.profile-prefill',
};

const contractModule = {
  ...applicantProfile,
  steps: [fieldsStub, contractStep],
};

describe('тест-контракт модуля applicant-profile', () => {
  it('проходит контракт', async () => {
    await assertModuleContract(contractModule, { readmePath: 'modules/applicant-profile/README.md' });
  });

  it('сквозной прогон без профиля не падает и ничего не подставляет', async () => {
    const { draft } = await runModuleContract({ modules: [applicantProfile] });

    expect(draft.fields).toEqual({});
  });
});
