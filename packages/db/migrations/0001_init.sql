-- 0001_init.sql — таблицы ядра, PostgreSQL 16 + pgvector.
-- Идемпотентно: можно запускать повторно.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS "user" (
  id text PRIMARY KEY,
  full_name text NOT NULL,
  role text NOT NULL,
  department_id text,
  position text NOT NULL
);

CREATE TABLE IF NOT EXISTS appeal (
  id text PRIMARY KEY,
  channel text NOT NULL,
  author_id text NOT NULL,
  original_text text NOT NULL,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS appeal_message (
  id text PRIMARY KEY,
  appeal_id text NOT NULL,
  direction text NOT NULL,
  kind text NOT NULL,
  body text NOT NULL,
  field_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ticket (
  id text PRIMARY KEY,
  number text NOT NULL,
  appeal_id text NOT NULL,
  status text NOT NULL,
  priority text,
  category text,
  department_id text,
  assignee_id text,
  is_emergency boolean NOT NULL DEFAULT false,
  incident_id text,
  sla_due_at timestamptz,
  confirmed_by text,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS ticket_field (
  ticket_id text NOT NULL,
  field_key text NOT NULL,
  value jsonb,
  confidence numeric(4, 3) NOT NULL,
  quote jsonb,
  origin text NOT NULL,
  needs_review boolean NOT NULL DEFAULT false,
  trace jsonb NOT NULL DEFAULT '[]'::jsonb,
  ai_value jsonb,
  PRIMARY KEY (ticket_id, field_key)
);

CREATE TABLE IF NOT EXISTS pipeline_run (
  id text PRIMARY KEY,
  ticket_id text,
  appeal_id text NOT NULL,
  mode text NOT NULL,
  status text NOT NULL,
  started_at timestamptz NOT NULL,
  finished_at timestamptz
);

CREATE TABLE IF NOT EXISTS pipeline_step (
  run_id text NOT NULL,
  step_id text NOT NULL,
  stage text NOT NULL,
  status text NOT NULL,
  duration_ms integer NOT NULL,
  ticket_id text,
  input jsonb,
  output jsonb,
  error text,
  model text,
  prompt_version text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS event_log (
  id text PRIMARY KEY,
  type text NOT NULL,
  at timestamptz NOT NULL,
  actor_kind text NOT NULL,
  actor_id text,
  ticket_id text,
  payload jsonb
);

CREATE TABLE IF NOT EXISTS dictionary_item (
  dictionary text NOT NULL,
  code text NOT NULL,
  label text NOT NULL,
  parent_code text,
  meta jsonb,
  PRIMARY KEY (dictionary, code)
);

CREATE TABLE IF NOT EXISTS field_def (
  key text PRIMARY KEY,
  def jsonb NOT NULL,
  module_id text
);

CREATE TABLE IF NOT EXISTS setting (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cmdb_location (
  id text PRIMARY KEY,
  kind text NOT NULL,
  name text NOT NULL,
  parent_id text
);

CREATE TABLE IF NOT EXISTS cmdb_equipment (
  id text PRIMARY KEY,
  type text NOT NULL,
  model text NOT NULL,
  serial text,
  inventory_no text,
  ip text,
  building text,
  cabinet text,
  criticality text NOT NULL
);

CREATE TABLE IF NOT EXISTS engineer_profile (
  user_id text PRIMARY KEY,
  department text NOT NULL,
  level text NOT NULL,
  buildings jsonb NOT NULL DEFAULT '[]'::jsonb,
  on_duty boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'available'
);

CREATE TABLE IF NOT EXISTS engineer_skill (
  user_id text NOT NULL,
  skill text NOT NULL,
  level integer NOT NULL,
  PRIMARY KEY (user_id, skill)
);

CREATE TABLE IF NOT EXISTS duty_shift (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  kind text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS kb_article (
  id text PRIMARY KEY,
  title text NOT NULL,
  symptoms jsonb NOT NULL DEFAULT '[]'::jsonb,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  solution text NOT NULL,
  category text,
  embedding vector(768)
);

CREATE TABLE IF NOT EXISTS notification (
  id text PRIMARY KEY,
  to_user_id text NOT NULL,
  channel text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  ticket_id text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_cache (
  key text PRIMARY KEY,
  port text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_log_ticket_at_idx ON event_log (ticket_id, at);
CREATE INDEX IF NOT EXISTS ticket_status_idx ON ticket (status);
CREATE INDEX IF NOT EXISTS ticket_field_ticket_id_idx ON ticket_field (ticket_id);
CREATE INDEX IF NOT EXISTS pipeline_step_run_id_idx ON pipeline_step (run_id);

-- Журнал действий только на добавление.
CREATE OR REPLACE FUNCTION event_log_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'event_log append-only: % запрещён', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS event_log_no_update_delete ON event_log;
CREATE TRIGGER event_log_no_update_delete
  BEFORE UPDATE OR DELETE ON event_log
  FOR EACH ROW EXECUTE FUNCTION event_log_append_only();
