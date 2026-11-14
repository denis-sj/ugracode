-- 0007_appeal_messages.sql — карточки в чате обращения и быстрый список истории.
-- Идемпотентно: можно запускать повторно.

ALTER TABLE appeal_message ADD COLUMN IF NOT EXISTS card jsonb;

CREATE INDEX IF NOT EXISTS appeal_message_appeal_created_idx
  ON appeal_message (appeal_id, created_at);
