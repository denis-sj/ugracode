-- 0010_article_checklist.sql — отметки шагов статьи базы знаний у заявки (задача 029).
-- Чек-лист инженера: состояние живёт у заявки, одна строка на шаг статьи. Идемпотентно.

CREATE TABLE IF NOT EXISTS ticket_article_step (
  ticket_id text NOT NULL,
  article_id text NOT NULL,
  step_index integer NOT NULL,
  done boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ticket_id, article_id, step_index)
);

CREATE INDEX IF NOT EXISTS ticket_article_step_ticket_idx ON ticket_article_step (ticket_id);
