import { AssigneeCandidate } from '@ugra/contracts';
import { z } from 'zod';

/** Навык инженера: уровень 1 — начальный, 5 — эксперт. */
export const EngineerSkill = z.object({
  skill: z.string().min(1),
  level: z.number().int().min(1).max(5),
});
export type EngineerSkill = z.infer<typeof EngineerSkill>;

/**
 * Профиль инженера из `data/engineers.json` (задача 008).
 * Поля со значениями по умолчанию разбираются терпимо: неполный профиль не ломает подбор.
 */
export const EngineerProfile = z.object({
  id: z.string().min(1),
  fullName: z.string().min(1),
  departmentId: z.string().default(''),
  /** Разряд/грейд инженера; в оценке не участвует, нужен карточке специалиста. */
  level: z.number().int().min(0).default(1),
  skills: z.array(EngineerSkill).default([]),
  buildings: z.array(z.string()).default([]),
  onShift: z.boolean().default(false),
  openTickets: z.number().int().min(0).default(0),
  resolvedSimilar: z.number().int().min(0).default(0),
});
export type EngineerProfile = z.infer<typeof EngineerProfile>;

/** Список инженеров без обёртки — встречается в тестовых данных и в `extra` ядра. */
export const EngineerList = z.array(EngineerProfile);
export type EngineerList = z.infer<typeof EngineerList>;

/** Файл `data/engineers.json`: `{ "engineers": [...] }`. */
export const EngineersFile = z.object({ engineers: EngineerList });
export type EngineersFile = z.infer<typeof EngineersFile>;

/** Ответ маршрута `GET /api/m/routing/candidates/:ticketId`. */
export const CandidatesResponse = z.object({ candidates: z.array(AssigneeCandidate) });
export type CandidatesResponse = z.infer<typeof CandidatesResponse>;
