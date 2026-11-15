import type { JSX } from 'react';
import { Button, Card } from '@ugra/ui';
import type { ArticleDraft, RelatedGroup } from './format';

interface DraftPanelProps {
  query: string;
  /** Сколько статей нашлось по запросу: если ноль, а заявки есть — это и есть «нет статьи». */
  articleCount: number;
  ticketsCount: number;
  related: readonly RelatedGroup[];
  draft: ArticleDraft | null;
  building: boolean;
  error: string | null;
  onBuild: () => void;
}

/** Черновик статьи из решений: собирается только из найденных статей и закрытых заявок. */
export function DraftPanel({
  query,
  articleCount,
  ticketsCount,
  related,
  draft,
  building,
  error,
  onBuild,
}: DraftPanelProps): JSX.Element | null {
  if (query.trim() === '') return null;
  if (draft === null && articleCount === 0 && ticketsCount === 0) return null;
  if (draft === null && articleCount > 0 && ticketsCount === 0) return null;

  const noArticle = articleCount === 0 && ticketsCount > 0;

  return (
    <Card className={noArticle ? 'kb-draft kb-draft--gap' : 'kb-draft'}>
      {draft === null ? (
        <>
          <p className="kb-draft__kicker">{noArticle ? 'Нет статьи, а заявки идут' : 'Инструмент'}</p>
          {noArticle && <p className="kb-draft__big">{ticketsCount}</p>}
          <h2 className="kb-draft__title">{noArticle ? query.trim() : 'Черновик статьи'}</h2>
          <p className="kb-draft__text">
            {noArticle
              ? 'Заявки по этой теме есть — соберём черновик из их решений и статей базы.'
              : 'Соберём статью из шагов найденных статей и решений по похожим заявкам.'}
          </p>
          {related.length > 0 && (
            <ul className="kb-related-list kb-related-list--compact">
              {related.slice(0, 3).map((group) => (
                <li key={group.title} className="kb-related-list__row">
                  <span className="kb-related-list__title">{group.title}</span>
                  <span className="kb-related-list__count">{group.count}</span>
                </li>
              ))}
            </ul>
          )}
          <Button variant="primary" block loading={building} onClick={onBuild}>
            Собрать черновик из решений
          </Button>
          {error && <p className="kb-draft__error">{error}</p>}
        </>
      ) : (
        <>
          <p className="kb-draft__kicker">Черновик статьи</p>
          <h2 className="kb-draft__title">{draft.title}</h2>

          {draft.symptoms.length > 0 && (
            <div className="kb-draft__block">
              <span className="kb-label">Симптомы из заявок</span>
              <ul className="kb-draft__symptoms">
                {draft.symptoms.map((symptom) => (
                  <li key={symptom}>{symptom}</li>
                ))}
              </ul>
            </div>
          )}

          {draft.steps.length > 0 && (
            <ol className="kb-draft__steps">
              {draft.steps.map((step) => (
                <li key={step.text}>
                  <span>{step.text}</span>
                  <small>из статьи «{step.articleTitle}»</small>
                </li>
              ))}
            </ol>
          )}

          {draft.solutions.length > 0 && (
            <div className="kb-draft__block">
              <span className="kb-label">Решения из заявок</span>
              <ul className="kb-draft__solutions">
                {draft.solutions.map((solution) => (
                  <li key={`${solution.number}-${solution.text}`}>
                    <span>{solution.text}</span>
                    {solution.number !== '' && <small>№ {solution.number}</small>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {draft.empty && (
            <p className="kb-draft__text">
              Решений в заявках пока не записано, а статьи нет — шаги дополнит инженер после выезда.
            </p>
          )}

          <p className="kb-draft__note">Черновик не сохранён: сохранения статьи в API пока нет.</p>
          <Button variant="secondary" block loading={building} onClick={onBuild}>
            Собрать заново
          </Button>
        </>
      )}
    </Card>
  );
}
