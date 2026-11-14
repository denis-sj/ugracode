import type { z } from 'zod';
import type { ExpectedCase, Metric } from '@ugra/contracts';

export interface ExtractionAspect<T = unknown> {
  key: string;
  schema: z.ZodType<T>;
  promptFile: string;
}

export interface Fact {
  label: string;
  value: string | number;
}

export interface ReportDeps {
  db: unknown;
  data: unknown;
  clock: { now(): Date };
}

export interface ReportDef<P = unknown, R = unknown> {
  id: string;
  title: string;
  question: string;
  params: z.ZodType<P>;
  result: z.ZodType<R>;
  compute(params: P, deps: ReportDeps): Promise<R>;
  facts?(result: R): Fact[];
  insightPromptId?: string;
  drilldown?(result: R, key: string): Record<string, unknown>;
}

export type { ExpectedCase, Metric };
