import { createHash } from 'node:crypto';
import type { LlmPort, LlmRequest, LlmResult } from '@ugra/core';

export interface CacheStore {
  get(key: string): Promise<unknown | null>;
  set(key: string, value: unknown): Promise<void>;
}

interface CachedEntry {
  value: unknown;
  model: string;
  promptVersion: string;
}

function isCachedEntry(value: unknown): value is CachedEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    'value' in value &&
    'model' in value &&
    'promptVersion' in value
  );
}

/** Стабильная сериализация: ключи объектов сортируются рекурсивно. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${entries.join(',')}}`;
}

function modelFor(req: LlmRequest<unknown>, override?: string): string {
  if (override) return override;
  if (req.tier === 'cheap') {
    return process.env.LLM_MODEL_CHEAP ?? process.env.LLM_MODEL_MAIN ?? 'cheap';
  }
  return process.env.LLM_MODEL_MAIN ?? 'main';
}

/** Ключ кэша: sha256(model + tier + promptId + стабильные vars). */
export function llmCacheKey(req: LlmRequest<unknown>, model?: string): string {
  const payload = JSON.stringify({
    model: modelFor(req, model),
    tier: req.tier ?? 'main',
    promptId: req.promptId,
    vars: stableStringify(req.vars ?? {}),
  });
  return createHash('sha256').update(payload).digest('hex');
}

/** Кэширующий декоратор над LlmPort. */
export class LlmCache implements LlmPort {
  constructor(
    private readonly inner: LlmPort,
    private readonly cache: CacheStore,
    private readonly model?: string,
  ) {}

  async structured<T>(req: LlmRequest<T>): Promise<LlmResult<T>> {
    const key = llmCacheKey(req, this.model);
    const hit = await this.cache.get(key);
    if (isCachedEntry(hit)) {
      const parsed = req.schema.safeParse(hit.value);
      if (parsed.success) {
        return {
          value: parsed.data,
          model: hit.model,
          promptVersion: hit.promptVersion,
          cached: true,
        };
      }
    }

    const result = await this.inner.structured(req);
    const entry: CachedEntry = {
      value: result.value,
      model: result.model,
      promptVersion: result.promptVersion,
    };
    await this.cache.set(key, entry);
    return result;
  }
}

export function withLlmCache(inner: LlmPort, cache: CacheStore, model?: string): LlmPort {
  return new LlmCache(inner, cache, model);
}

/**
 * Режим cache-only: при попадании отдаёт кэш, при промахе — fallback (stub).
 * Кэш при этом не пополняется, чтобы не подменять реальные данные заглушкой.
 */
export class CacheOnlyLlm implements LlmPort {
  constructor(
    private readonly cache: CacheStore,
    private readonly fallback: LlmPort,
    private readonly model?: string,
  ) {}

  async structured<T>(req: LlmRequest<T>): Promise<LlmResult<T>> {
    const key = llmCacheKey(req, this.model);
    const hit = await this.cache.get(key);
    if (isCachedEntry(hit)) {
      const parsed = req.schema.safeParse(hit.value);
      if (parsed.success) {
        return {
          value: parsed.data,
          model: hit.model,
          promptVersion: hit.promptVersion,
          cached: true,
        };
      }
    }
    return this.fallback.structured(req);
  }
}

export function cacheOnlyLlm(cache: CacheStore, fallback: LlmPort, model?: string): LlmPort {
  return new CacheOnlyLlm(cache, fallback, model);
}

/** Простейший in-memory CacheStore. */
export function memoryCacheStore(): CacheStore {
  const map = new Map<string, unknown>();
  return {
    async get(key: string): Promise<unknown | null> {
      return map.has(key) ? map.get(key) : null;
    },
    async set(key: string, value: unknown): Promise<void> {
      map.set(key, value);
    },
  };
}
