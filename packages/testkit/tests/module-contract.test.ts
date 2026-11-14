import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defineModule } from '@ugra/core';
import type { ModuleDefinition } from '@ugra/core';
import { assertModuleContract, makeField, runModuleContract } from '../src/index';

const readmeDir = mkdtempSync(join(tmpdir(), 'ugra-testkit-'));
const readmePath = join(readmeDir, 'README.md');
writeFileSync(readmePath, '# sample\n\nТестовый модуль.\n', 'utf8');

function sampleDefinition(patch: Partial<ModuleDefinition> = {}): ModuleDefinition {
  return {
    id: 'sample',
    title: 'Тестовый модуль',
    enabledByDefault: true,
    steps: [
      {
        id: 'sample.extract',
        title: 'Извлекаем кабинет',
        stage: 'extract',
        order: 10,
        reads: ['sources'],
        writes: ['fields'],
        async run() {
          return { fields: { cabinet: makeField('cabinet', '312') } };
        },
      },
    ],
    events: [{ type: 'sample.happened', description: 'Тестовое событие случилось' }],
    routes(router) {
      router.get('/ping', 'tickets.read', () => ({ ok: true }));
    },
    ...patch,
  };
}

const assessModule = defineModule({
  id: 'assess',
  title: 'Тестовая оценка',
  enabledByDefault: true,
  steps: [
    {
      id: 'assess.priority',
      title: 'Ставим приоритет',
      stage: 'assess',
      order: 10,
      reads: ['fields'],
      writes: ['priority'],
      async run(ctx) {
        const known = ctx.draft.fields.cabinet !== undefined;
        return {
          priority: {
            value: known ? 'medium' : 'low',
            reactDueAt: null,
            slaDueAt: '2026-11-15T10:00:00.000Z',
            rule: 'тест',
            reasons: [],
          },
        };
      },
    },
  ],
});

function makeSample(patch: Partial<ModuleDefinition> = {}): ReturnType<typeof defineModule> {
  return defineModule(sampleDefinition(patch));
}

describe('assertModuleContract', () => {
  it('пропускает корректный модуль', async () => {
    await expect(assertModuleContract(makeSample(), { readmePath })).resolves.toBeUndefined();
  });

  it('падает, если у модуля нет README', async () => {
    await expect(
      assertModuleContract(makeSample(), { readmePath: join(readmeDir, 'missing', 'README.md') }),
    ).rejects.toThrow(/README/);
  });

  it('падает, если шаг читает поле без писателя', async () => {
    const module = makeSample({
      steps: [
        {
          id: 'sample.extract',
          title: 'Читаем несуществующее поле',
          stage: 'extract',
          reads: ['fields'],
          writes: ['ext'],
          async run() {
            return {};
          },
        },
      ],
    });
    await expect(assertModuleContract(module, { readmePath })).rejects.toThrow(/fields/);
  });

  it('падает, если событие без префикса модуля', async () => {
    const module = makeSample({
      events: [{ type: 'happened', description: 'Событие без префикса' }],
    });
    await expect(assertModuleContract(module, { readmePath })).rejects.toThrow(/sample\./);
  });

  it('падает, если маршрут без права доступа', async () => {
    const module = makeSample({
      routes(router) {
        router.get('/ping', 'any', () => ({ ok: true }));
      },
    });
    await expect(assertModuleContract(module, { readmePath })).rejects.toThrow(/access/);
  });
});

describe('runModuleContract', () => {
  it('проходит с двумя модулями и возвращает черновик полного прогона', async () => {
    const { draft } = await runModuleContract({
      modules: [makeSample(), assessModule],
    });
    expect(draft.fields.cabinet?.value).toBe('312');
    expect(draft.priority?.value).toBe('medium');
  });
});
