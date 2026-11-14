import { z } from 'zod';

/**
 * Итог агента `vision` (раздел 2 спецификации харнесса): текстовое описание картинки
 * и то, что на ней удалось прочитать. Вход у агента — сама картинка, поэтому
 * инструменты ему не нужны, результат приходит одним `submit`.
 */
export const VisionSubmit = z.object({
  text: z.string().min(1).max(2000),
  program: z.string().max(120).optional(),
  errorCode: z.string().max(60).optional(),
  model: z.string().max(120).optional(),
  serial: z.string().max(120).optional(),
});
export type VisionSubmit = z.infer<typeof VisionSubmit>;

/** Данные шага в `draft.ext.screenshot`: распознали картинку или нет — это видит диспетчер. */
export const ScreenshotExt = z.object({
  status: z.enum(['recognized', 'failed']),
  sourceId: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  error: z.string().optional(),
});
export type ScreenshotExt = z.infer<typeof ScreenshotExt>;
