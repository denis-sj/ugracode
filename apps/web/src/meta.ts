import type { MetaResponse } from '@ugra/contracts';

/** Однострочная сводка по `/api/meta` — вынесена из UI, чтобы тестировать без DOM. */
export function describeMeta(meta: MetaResponse): string {
  return `Модулей: ${meta.modules.length}, режим: ${meta.aiMode}, полей: ${meta.fields.length}`;
}
