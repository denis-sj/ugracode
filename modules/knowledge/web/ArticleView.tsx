import type { CSSProperties, JSX } from 'react';
import { Button, Card } from '@ugra/ui';
import type { ArticleRow, RelatedGroup } from './format';
import { pluralRu } from './format';

interface ArticleViewProps {
  row: ArticleRow;
  /** Лучшее совпадение получает метку, остальные — просто «Статья». */
  best: boolean;
  checked: Readonly<Record<string, boolean>>;
  related: readonly RelatedGroup[];
  /** Сколько заявок собрано в статью — только по данным поиска. */
  collected: number;
  taking: boolean;
  onToggleStep: (index: number) => void;
  onTakeToTask: () => void;
}

/** Кольцо статистики: доля из данных статьи, иначе блок не рисуем. */
function HelpRing({ helped, total }: { helped: number; total: number }): JSX.Element {
  const percent = Math.round(Math.min(helped / total, 1) * 100);
  return (
    <span
      className="kb-ring"
      style={{ '--kb-ring': percent } as CSSProperties}
      role="img"
      aria-label={`Решение помогало в ${percent}% случаев`}
    >
      <b>{percent}%</b>
    </span>
  );
}

/** Статья целиком: шаги чек-листом, связанные заявки и кнопка «Взять в задачу». */
export function ArticleView({
  row,
  best,
  checked,
  related,
  collected,
  taking,
  onToggleStep,
  onTakeToTask,
}: ArticleViewProps): JSX.Element {
  const { article } = row;
  const current = article.steps.findIndex((_step, index) => !checked[`${article.id}:${index}`]);

  return (
    <Card as="article" className="kb-article">
      <div className="kb-article__head">
        <div className="kb-article__intro">
          <p className="kb-article__tag">{best ? 'Лучшее совпадение' : 'Статья'}</p>
          <h2 className="kb-article__title">{row.title}</h2>
        </div>
        {row.helpLabel !== null && (
          <div className="kb-article__help">
            <HelpRing helped={article.stats?.helped ?? 0} total={article.stats?.total ?? 1} />
            <span className="kb-article__help-text">{row.helpLabel}</span>
          </div>
        )}
      </div>

      {article.steps.length > 0 && (
        <ol className="kb-steps">
          {article.steps.map((step, index) => {
            const done = Boolean(checked[`${article.id}:${index}`]);
            const now = !done && index === Math.max(current, 0);
            const state = done ? 'done' : now ? 'now' : 'next';
            return (
              <li key={`${article.id}:${index}`}>
                <button
                  type="button"
                  className={`kb-step kb-step--${state}`}
                  aria-pressed={done}
                  onClick={() => onToggleStep(index)}
                >
                  <span className="kb-step__mark" aria-hidden="true">
                    {done ? '✓' : index + 1}
                  </span>
                  <span className="kb-step__text">{step}</span>
                </button>
              </li>
            );
          })}
        </ol>
      )}

      {article.solution !== '' && (
        <p className="kb-article__solution">
          <strong>Что обычно помогает.</strong> {article.solution}
        </p>
      )}

      {related.length > 0 && (
        <section className="kb-article__related">
          <h3 className="kb-article__related-title">Связанные заявки</h3>
          <ul className="kb-related-list">
            {related.slice(0, 4).map((group) => (
              <li key={group.title} className="kb-related-list__row">
                <span className="kb-related-list__title">{group.title}</span>
                <span className="kb-related-list__count">{group.count}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="kb-article__foot">
        <span className="kb-article__collected">
          {collected > 0
            ? `В базе ${collected} ${pluralRu(collected, 'заявка', 'заявки', 'заявок')} по теме`
            : 'Решение из базы знаний'}
        </span>
        <Button variant="primary" loading={taking} onClick={onTakeToTask}>
          Взять в задачу
        </Button>
      </footer>
    </Card>
  );
}
