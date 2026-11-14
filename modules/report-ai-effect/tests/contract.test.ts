import { describe, expect, it } from 'vitest';
import { MemoryStore } from '@ugra/core';
import { assertModuleContract } from '@ugra/testkit';
import reportAiEffect, { aiEffectReport, factsOf } from '../server';
import { computeAiEffect } from '../server/compute';

const clock = { now: () => new Date(2026, 10, 14, 12, 0, 0) };

describe('контракт модуля report-ai-effect', () => {
  it('проходит тест-контракт и объявляет отчёт О5', async () => {
    await assertModuleContract(reportAiEffect);
    expect(reportAiEffect.reports).toHaveLength(1);
    expect(aiEffectReport.id).toBe('ai-effect.summary');
    expect(aiEffectReport.params.safeParse({ days: 30 }).success).toBe(true);
    expect(aiEffectReport.params.safeParse({ days: 0 }).success).toBe(false);
    expect(aiEffectReport.insightPromptId).toBe('modules/report-ai-effect/prompts/insight.v1.md');
  });

  it('факты непустые и честно показывают отсутствие ручного замера', async () => {
    const result = await computeAiEffect(
      { days: 30 },
      { db: new MemoryStore(), data: undefined, clock },
    );
    const facts = factsOf(result);
    expect(facts.length).toBeGreaterThan(0);
    expect(facts.every((fact) => String(fact.value).trim() !== '')).toBe(true);
    expect(facts.find((fact) => fact.label === 'Сравнение с ручным режимом')?.value).toBe(
      'нет данных',
    );
    expect(facts.find((fact) => fact.label === 'Без правок, %')?.value).toBe('нет данных');
  });
});
