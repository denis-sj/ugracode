import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ClockPort, EmbeddingsPort, Ports, SpeechPort } from '@ugra/core';
import { StubLlm } from './llm/stub';
import { PolzaLlm, DEFAULT_POLZA_BASE_URL } from './llm/polza';
import { StubEmbeddings } from './embeddings/stub';
import { PolzaEmbeddings } from './embeddings/polza';
import { StubSpeech } from './speech/stub';
import { PolzaSpeech } from './speech/polza';
import { StubVision } from './vision/stub';
import { StubCmdb, parseEquipment } from './cmdb/stub';
import { StubTicketHistory } from './history/stub';
import { InMemoryNotifications } from './notifications/stub';
import { SystemClock } from './clock/system';

export * from './llm/stub';
export * from './llm/polza';
export * from './embeddings/stub';
export * from './embeddings/polza';
export * from './speech/stub';
export * from './speech/polza';
export * from './vision/stub';
export * from './cmdb/stub';
export * from './history/stub';
export * from './notifications/stub';
export * from './clock/system';
export * from './clock/fixed';

export type AiMode = 'stub' | 'cloud';

export interface CreatePortsResult extends Ports {
  /** Фактический режим ИИ после проверки ключа и флага AI_MODE. */
  aiMode: AiMode;
}

function aiModeFrom(env: NodeJS.ProcessEnv): AiMode {
  const raw = env.AI_MODE;
  return raw === 'cloud' ? raw : 'stub';
}

function loadEquipment(env: NodeJS.ProcessEnv) {
  const path = resolve(process.cwd(), env.CMDB_PATH ?? 'data/cmdb.json');
  if (!existsSync(path)) {
    return new StubCmdb();
  }
  try {
    return new StubCmdb(parseEquipment(JSON.parse(readFileSync(path, 'utf8'))));
  } catch {
    return new StubCmdb();
  }
}

function buildCloudPorts(env: NodeJS.ProcessEnv): {
  llm: StubLlm | PolzaLlm;
  embeddings: EmbeddingsPort;
  speech: SpeechPort;
  clock: ClockPort;
} {
  const apiKey = env.POLZA_API_KEY;
  const baseURL = env.POLZA_BASE_URL ?? DEFAULT_POLZA_BASE_URL;
  const llm = apiKey ? new PolzaLlm({ apiKey, baseURL }) : new StubLlm();
  const embeddings = apiKey ? new PolzaEmbeddings({ apiKey, baseURL }) : new StubEmbeddings();
  const speech = apiKey ? new PolzaSpeech({ apiKey, baseURL }) : new StubSpeech();
  return { llm, embeddings, speech, clock: new SystemClock() };
}

/**
 * Собирает все порты по окружению.
 * AI_MODE=stub (по умолчанию) — заглушки; cloud — Polza при наличии ключа.
 * Кэша ответов модели нет (решение владельца 2026-11-14).
 */
export function createPorts(env: NodeJS.ProcessEnv = process.env): CreatePortsResult {
  const requested = aiModeFrom(env);
  const useCloud = requested === 'cloud' && Boolean(env.POLZA_API_KEY);
  const cloud = useCloud ? buildCloudPorts(env) : undefined;

  const llm = cloud?.llm ?? new StubLlm();

  const embeddings: EmbeddingsPort = cloud?.embeddings ?? new StubEmbeddings();
  const speech: SpeechPort = cloud?.speech ?? new StubSpeech();

  return {
    aiMode: requested,
    llm,
    embeddings,
    speech,
    vision: new StubVision(),
    cmdb: loadEquipment(env),
    history: new StubTicketHistory(),
    notifications: new InMemoryNotifications(),
    clock: cloud?.clock ?? new SystemClock(),
  };
}
