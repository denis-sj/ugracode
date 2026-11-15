import type { CSSProperties, JSX } from 'react';
import { Button, EmptyState } from '@ugra/ui';
import type { KnowledgeArticle } from './format';
import { articleHelp, stepCounterLabel, stepStates } from './format';

interface DiagnosticsPanelProps {
  article: KnowledgeArticle | null;
  checked: Readonly<Record<string, boolean>>;
  loading: boolean;
  error: string | null;
  query: string;
  onToggle: (articleId: string, stepIndex: number) => void;
  onRetry: () => void;
  onOpenSearch: (query: string) => void;
}

/** Кольцо «помогла N из M раз»: доля из данных статьи, а не выдуманный процент. */
function HelpRing({ ratio }: { ratio: number }): JSX.Element {
  const percent = Math.round(Math.min(Math.max(ratio, 0), 1) * 100);
  return (
    <span
      className="ed-ring"
      style={{ '--ed-ring': percent } as CSSProperties}
      role="img"
      aria-label={`Решение помогало в ${percent}% случаев`}
    >
      <span className="ugra-sr-only">{percent}%</span>
    </span>
  );
}

/** Диагностика из статьи базы знаний: шаги чек-листом и честная статистика, если она есть. */
export function DiagnosticsPanel({
  article,
  checked,
  loading,
  error,
  query,
  onToggle,
  onRetry,
  onOpenSearch,
}: DiagnosticsPanelProps): JSX.Element {
  const states = article ? stepStates(article.steps, checked, article.id) : [];
  const done = states.filter((state) => state === 'done').length;
  const help = articleHelp(article);

  return (
    <section className="ed-diag" data-reveal>
      <div className="ed-diag__head">
        <div className="ed-diag__intro">
          <h2 className="ed-diag__title">Диагностика</h2>
          <p className="ed-diag__src">
            {article
              ? `по статье «${article.title}» · ${stepCounterLabel(done, article.steps.length)}`
              : 'шаги из базы знаний по симптомам заявки'}
          </p>
        </div>
        {help && (
          <div className="ed-help">
            <HelpRing ratio={help.ratio} />
            <span className="ed-help__text">
              <b>
                {help.helped} из {help.total}
              </b>
              <small>{help.label.replace(/^помогла /u, '')}</small>
            </span>
          </div>
        )}
      </div>

      {loading && (
        <div className="ed-skeleton" aria-label="Ищем статью в базе знаний">
          <span className="ed-skeleton__line" />
          <span className="ed-skeleton__line ed-skeleton__line--short" />
        </div>
      )}

      {!loading && error && (
        <div className="ed-inline-error" role="alert">
          <p>{error}</p>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Повторить
          </Button>
        </div>
      )}

      {!loading && !error && article && article.steps.length > 0 && (
        <ol className="ed-steps">
          {article.steps.map((step, index) => {
            const state = states[index] ?? 'next';
            const key = `${article.id}:${index}`;
            return (
              <li key={key}>
                <button
                  type="button"
                  className={`ed-step ed-step--${state}`}
                  aria-pressed={state === 'done'}
                  onClick={() => onToggle(article.id, index)}
                >
                  <span className="ed-step__mark" aria-hidden="true">
                    {state === 'done' ? '✓' : index + 1}
                  </span>
                  <span className="ed-step__text">{step}</span>
                </button>
              </li>
            );
          })}
        </ol>
      )}

      {!loading && !error && article && (
        <button
          type="button"
          className="ed-link"
          onClick={() => onOpenSearch(article.title)}
        >
          Открыть статью в базе знаний
        </button>
      )}

      {!loading && !error && !article && (
        <EmptyState
          title={query ? 'Статья не найдена' : 'Недостаточно данных'}
          hint={
            query
              ? 'Поищите решение в базе знаний своими словами — статья могла называться иначе.'
              : 'В заявке нет симптомов и оборудования — поиск по базе знаний не с чем сопоставить.'
          }
        >
          <Button variant="secondary" size="sm" onClick={() => onOpenSearch(query)}>
            Открыть базу знаний
          </Button>
        </EmptyState>
      )}
    </section>
  );
}
