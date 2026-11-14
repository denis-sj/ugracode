-- 0004_knowledge_search.sql — поиск по базе знаний словами, без pgvector (задача 013).
-- Полнотекстовый поиск Postgres с русской морфологией + ILIKE; идемпотентно.

-- Статьи: фильтр по категории (сравнение без регистра — как в MemoryStore).
CREATE INDEX IF NOT EXISTS kb_article_category_idx ON kb_article (lower(category));

-- Регистронезависимый поиск по заголовку (ILIKE без приведения регистра индекса не использует).
CREATE INDEX IF NOT EXISTS kb_article_title_lower_idx ON kb_article (lower(title));

-- Полнотекстовый индекс: те же поля и та же конфигурация, что в PgStore.searchKnowledge().
CREATE INDEX IF NOT EXISTS kb_article_fts_idx ON kb_article USING gin (
  to_tsvector(
    'russian',
    coalesce(title, '') || ' ' || coalesce(symptoms::text, '') || ' ' || coalesce(solution, '')
  )
);

-- Похожие заявки: фильтры по категории и полям `building` / `symptoms`.
CREATE INDEX IF NOT EXISTS ticket_category_idx ON ticket (lower(category));
CREATE INDEX IF NOT EXISTS ticket_field_lookup_idx ON ticket_field (field_key, ticket_id);
