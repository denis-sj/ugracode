-- 0003_agent_step.sql — след агента (задача 031).
-- Один вызов инструмента (или submit) внутри прогона агента. Идемпотентно.

CREATE TABLE IF NOT EXISTS agent_step (
  run_id text NOT NULL,
  n integer NOT NULL,
  tool text NOT NULL,
  args jsonb,
  result_summary text NOT NULL,
  blocked boolean NOT NULL DEFAULT false,
  error text,
  duration_ms integer NOT NULL,
  tokens_in integer,
  tokens_out integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, n)
);

CREATE INDEX IF NOT EXISTS agent_step_run_id_idx ON agent_step (run_id);
