import type { JSX } from 'react';
import { useMemo, useRef, useState } from 'react';
import { Card, Icon, cx, useListMotion } from '@ugra/ui';
import { catalogGroups, pluralRu } from './format';
import type { KnowledgeArticle } from './format';

export interface ArticleCatalogProps {
  articles: readonly KnowledgeArticle[];
  labels: Readonly<Record<string, string>>;
  loading: boolean;
  /** Открыть статью: экран ищет её по названию и показывает шаги. */
  onOpen: (article: KnowledgeArticle) => void;
}

const ALL = 'all';

/**
 * Каталог базы знаний на пустом экране: вся база карточками по категориям.
 * Инженер сразу видит, что в базе есть, и открывает статью одним кликом.
 */
export function ArticleCatalog({ articles, labels, loading, onOpen }: ArticleCatalogProps): JSX.Element {
  const [category, setCategory] = useState(ALL);
  const groups = useMemo(() => catalogGroups(articles, labels), [articles, labels]);
  const visible = category === ALL ? articles : articles.filter((article) => article.category === category);
  const listRef = useRef<HTMLDivElement | null>(null);
  useListMotion(listRef, visible.length > 0);

  if (loading && articles.length === 0) {
    return (
      <Card className="kb-catalog">
        <p className="kb-catalog__lead">Загружаем базу знаний…</p>
      </Card>
    );
  }

  return (
    <Card className="kb-catalog" padded={false}>
      <header className="kb-catalog__head">
        <div>
          <h2 className="kb-catalog__title">
            В базе {articles.length} {pluralRu(articles.length, 'статья', 'статьи', 'статей')}
          </h2>
          <p className="kb-catalog__lead">Опишите проблему в поиске или откройте статью — шаги и решение сразу под рукой.</p>
        </div>
        <div className="kb-catalog__chips" role="tablist" aria-label="Категории статей">
          <button
            type="button"
            role="tab"
            aria-selected={category === ALL}
            className={cx('kb-catalog__chip', category === ALL && 'kb-catalog__chip--on')}
            onClick={() => setCategory(ALL)}
          >
            Все <span>{articles.length}</span>
          </button>
          {groups.map((group) => (
            <button
              type="button"
              role="tab"
              key={group.code}
              aria-selected={category === group.code}
              className={cx('kb-catalog__chip', category === group.code && 'kb-catalog__chip--on')}
              onClick={() => setCategory(group.code)}
            >
              {group.label} <span>{group.count}</span>
            </button>
          ))}
        </div>
      </header>

      <div className="kb-catalog__grid" ref={listRef}>
        {visible.map((article) => (
          <button type="button" className="kb-catalog__card" key={article.id} onClick={() => onOpen(article)}>
            <span className="kb-catalog__cat">
              <Icon name="kb" size={14} />
              {labels[article.category ?? ''] ?? article.category ?? 'Без категории'}
            </span>
            <strong className="kb-catalog__name">{article.title}</strong>
            {article.symptoms[0] && <span className="kb-catalog__symptom">«{article.symptoms[0]}»</span>}
            <span className="kb-catalog__meta">
              {article.steps.length} {pluralRu(article.steps.length, 'шаг', 'шага', 'шагов')} · открыть →
            </span>
          </button>
        ))}
      </div>
    </Card>
  );
}
