import { z } from 'zod';
import { PriorityLevel } from '@ugra/contracts';

/** Матрица приоритета из `data/priority-matrix.json` (`data.extra.priorityMatrix`). */
export const PriorityLevelDef = z.object({
  label: z.string(),
  reactMinutes: z.number().nonnegative(),
  slaMinutes: z.number().nonnegative(),
  order: z.number(),
  computed: z.boolean().optional(),
});
export type PriorityLevelDef = z.infer<typeof PriorityLevelDef>;

export const PriorityMatrix = z.object({
  levels: z.record(z.string(), PriorityLevelDef),
  /** impact → urgency → уровень. */
  matrix: z.record(z.string(), z.record(z.string(), PriorityLevel)),
});
export type PriorityMatrix = z.infer<typeof PriorityMatrix>;

/** Берём из черновика только критичность техники: остальное (`equipmentId`, `locationId`) — не наше дело. */
export const ExtractionCmdbHint = z.object({
  extraction: z
    .object({
      cmdb: z
        .object({
          criticality: z.enum(['low', 'medium', 'high', 'critical']).optional(),
        })
        .optional(),
    })
    .optional(),
});
export type ExtractionCmdbHint = z.infer<typeof ExtractionCmdbHint>;
