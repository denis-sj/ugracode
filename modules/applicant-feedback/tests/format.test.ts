import { describe, expect, it } from 'vitest';
import { replyDraftFromAnalysis, replyDraftLabel, replyDraftText } from '../web/format';

describe('applicant-feedback: данные виджета ответа', () => {
  it('берёт черновик из анализа заявки', () => {
    const draft = replyDraftFromAnalysis({
      replyDraft: { text: 'Заявка № 12 принята.', template: true },
    });

    expect(draft).toEqual({ text: 'Заявка № 12 принята.', template: true });
    expect(replyDraftText(draft)).toBe('Заявка № 12 принята.');
    expect(replyDraftLabel(draft)).toBe('Шаблон из данных заявки');
  });

  it('черновик модели подписан как ИИ', () => {
    const draft = replyDraftFromAnalysis({ replyDraft: { text: 'Здравствуйте!', template: false } });

    expect(replyDraftLabel(draft)).toBe('Черновик ИИ — проверьте перед отправкой');
  });

  it('нет анализа, нет черновика или он битый — пусто, без падения', () => {
    expect(replyDraftFromAnalysis(null)).toBeNull();
    expect(replyDraftFromAnalysis(undefined)).toBeNull();
    expect(replyDraftFromAnalysis('строка')).toBeNull();
    expect(replyDraftFromAnalysis({})).toBeNull();
    expect(replyDraftFromAnalysis({ replyDraft: null })).toBeNull();
    expect(replyDraftFromAnalysis({ replyDraft: { text: 42 } })).toBeNull();
    expect(replyDraftText(null)).toBe('');
    expect(replyDraftLabel(null)).toBe('Черновика нет — напишите ответ сами');
  });

  it('пустой текст шаблона не проходит схему — диспетчер пишет сам', () => {
    expect(replyDraftFromAnalysis({ replyDraft: { text: '', template: true } })).toBeNull();
  });
});
