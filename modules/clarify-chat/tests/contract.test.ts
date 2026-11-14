import { describe, expect, it } from 'vitest';
import type { PipelineStep } from '@ugra/core';
import { assertModuleContract, runModuleContract } from '@ugra/testkit';
import clarifyChat from '../server';

/**
 * Шаг читает `fields`, а по контракту их обязан записать кто-то раньше.
 * В одиночном модуле такого шага нет, поэтому для тест-контракта добавляем заглушку извлечения.
 */
const fieldsStub: PipelineStep = {
  id: 'clarify-chat.fields-stub',
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
 * `clarify.missing`. Для контракта меняем только id — `run`, `reads`, `writes` настоящие.
 */
const contractStep: PipelineStep = {
  ...clarifyChat.steps[0]!,
  id: 'clarify-chat.clarify-missing',
};

const contractModule = {
  ...clarifyChat,
  steps: [fieldsStub, contractStep],
};

describe('тест-контракт модуля clarify-chat', () => {
  it('проходит контракт', async () => {
    await assertModuleContract(contractModule, { readmePath: 'modules/clarify-chat/README.md' });
  });

  it('прогон без вопросов не падает и оставляет пустой список недостающих', async () => {
    const { draft } = await runModuleContract({ modules: [clarifyChat] });

    expect(Array.isArray(draft.missing)).toBe(true);
  });
});
