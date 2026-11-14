import { ReplyDraft } from '@ugra/contracts';

/**
 * Данные виджета `ticket.footer`: черновик ответа из `GET /api/tickets/:id/analysis`.
 * Всё терпимо к форме ответа: нет черновика или он битый — виджета нет, диспетчер пишет сам.
 */

export type ReplyDraftData = ReplyDraft;

/** `analysis.replyDraft` → проверенный черновик; нет или не прошёл схему — `null`. */
export function replyDraftFromAnalysis(analysis: unknown): ReplyDraftData | null {
  if (typeof analysis !== 'object' || analysis === null) return null;
  const raw = (analysis as { replyDraft?: unknown }).replyDraft;
  if (raw === undefined || raw === null) return null;
  const parsed = ReplyDraft.safeParse(raw);
  if (!parsed.success || parsed.data.text.trim() === '') return null;
  return parsed.data;
}

/** Текст для поля ввода: черновик есть — его, иначе пусто (пишет диспетчер). */
export function replyDraftText(draft: ReplyDraftData | null): string {
  return draft?.text ?? '';
}

/** Подпись источника: шаблон из данных заявки или текст, переписанный моделью. */
export function replyDraftLabel(draft: ReplyDraftData | null): string {
  if (!draft) return 'Черновика нет — напишите ответ сами';
  return draft.template ? 'Шаблон из данных заявки' : 'Черновик ИИ — проверьте перед отправкой';
}
