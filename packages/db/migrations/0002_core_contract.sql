-- 0002_core_contract.sql — правка контрактов после брейншторна (задача 024).
-- Добавляющие изменения: срок реакции, связки с CMDB. Кэш ответов модели убран.

ALTER TABLE ticket ADD COLUMN IF NOT EXISTS react_due_at timestamptz;
ALTER TABLE ticket ADD COLUMN IF NOT EXISTS equipment_id text;
ALTER TABLE ticket ADD COLUMN IF NOT EXISTS location_id text;

DROP TABLE IF EXISTS ai_cache;
