import type { z } from 'zod';

export interface ImageInput {
  kind: 'image';
  data: string;
  mimeType: string;
}

export interface AudioInput {
  kind: 'audio';
  data: string;
  mimeType: string;
}

export interface Transcript {
  text: string;
  language?: string;
  confidence?: number;
}

export interface VisionResult {
  text: string;
  confidence?: number;
}

export interface LlmResult<T> {
  value: T;
  model: string;
  promptVersion: string;
  cached: boolean;
}

export interface LlmRequest<T> {
  promptId: string;
  vars: Record<string, unknown>;
  schema: z.ZodType<T>;
  images?: ImageInput[];
  tier?: 'main' | 'cheap';
}

export interface LlmPort {
  structured<T>(req: LlmRequest<T>): Promise<LlmResult<T>>;
}

export interface EmbeddingsPort {
  embed(texts: string[]): Promise<number[][]>;
}

export interface SpeechPort {
  transcribe(audio: AudioInput): Promise<Transcript>;
}

export interface VisionPort {
  describe(image: ImageInput, promptId: string): Promise<VisionResult>;
}

export interface EquipmentQuery {
  building?: string;
  cabinet?: string;
  type?: string;
  model?: string;
  serial?: string;
  inventoryNo?: string;
  ip?: string;
  text?: string;
}

export interface Equipment {
  id: string;
  type: string;
  model: string;
  serial: string | null;
  inventoryNo: string | null;
  ip: string | null;
  building: string;
  cabinet: string;
  criticality: 'low' | 'medium' | 'high' | 'critical';
}

export interface LocationNode {
  id: string;
  kind: 'building' | 'floor' | 'cabinet';
  name: string;
  parentId: string | null;
}

export interface CmdbPort {
  findEquipment(query: EquipmentQuery): Promise<Equipment[]>;
  locations(): Promise<LocationNode[]>;
}

export interface SimilarTicket {
  ticketId: string;
  number: string;
  title: string;
  score: number;
}

export interface TicketHistoryPort {
  similar(embedding: number[], limit: number): Promise<SimilarTicket[]>;
}

export interface Notification {
  toUserId: string;
  channel: 'email' | 'telegram' | 'inapp';
  title: string;
  body: string;
  ticketId?: string;
}

export interface DeliveryResult {
  delivered: boolean;
  id?: string;
}

export interface NotificationPort {
  send(n: Notification): Promise<DeliveryResult>;
}

export interface ClockPort {
  now(): Date;
}

export interface Ports {
  llm: LlmPort;
  embeddings: EmbeddingsPort;
  speech: SpeechPort;
  vision: VisionPort;
  cmdb: CmdbPort;
  history: TicketHistoryPort;
  notifications: NotificationPort;
  clock: ClockPort;
}

export type PortName = keyof Ports;
