import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createReferenceData, MemoryStore } from '@ugra/core';
import historySeed from '../../history-seed/server';
import { KbGapsResult } from '../contracts';
import { computeKbGaps } from '../server/compute';

const clock = { now: () => new Date('2026-11-14T12:00:00.000Z') };
const KB_FILES = ['hardware', 'network', 'printers', 'software'] as const;

interface KbFile {
  articles: {
    id: string;
    title: string;
    symptoms: string[];
    steps: string[];
    solution: string;
    category: string | null;
  }[];
}

/** Сквозная проверка демо: статьи из `data/kb` + история из сида → О6 находит реальные пробелы. */
describe('база знаний и история вместе', () => {
  it('делит заявки истории на «статья есть» и «статьи нет»', async () => {
    const store = new MemoryStore();
    const data = createReferenceData();
    for (const file of KB_FILES) {
      const parsed = JSON.parse(
        readFileSync(new URL(`../../../data/kb/${file}.json`, import.meta.url), 'utf8'),
      ) as KbFile;
      for (const article of parsed.articles) await store.saveKnowledgeArticle(article);
    }
    await historySeed.seed?.({ db: store, data, clock });

    const result = await computeKbGaps({ days: 200 }, { db: store, data, clock });

    expect(result.summary.total).toBeGreaterThan(500);
    expect(result.summary.withoutArticle).toBeGreaterThan(0);
    expect(result.summary.withoutArticle).toBeLessThan(result.summary.total);
    expect(result.summary.withArticle + result.summary.withoutArticle).toBe(result.summary.total);
    expect(result.summary.fromKnowledgeBase).toBe(result.summary.total);
    expect(result.themes.length).toBeGreaterThan(0);
    expect(result.themes[0]?.count).toBeGreaterThan(1);
    for (const theme of result.themes) {
      expect(theme.count).toBeLessThanOrEqual(result.summary.withoutArticle);
    }
    expect(() => KbGapsResult.parse(result)).not.toThrow();
  });
});
