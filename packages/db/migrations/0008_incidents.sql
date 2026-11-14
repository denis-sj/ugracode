-- 0008_incidents.sql — инцидент массовости (задача 016).
-- Модуль `mass-incident` склеивает похожие обращения в одну карточку.
-- Связь `ticket.incident_id` создана в 0001_init.sql. Идемпотентно.

CREATE TABLE IF NOT EXISTS incident (
  id text PRIMARY KEY,
  number text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  category text,
  building text,
  system text,
  size integer NOT NULL DEFAULT 0,
  priority text,
  opened_at timestamptz NOT NULL,
  closed_at timestamptz
);

CREATE INDEX IF NOT EXISTS incident_status_opened_at_idx ON incident (status, opened_at);
CREATE INDEX IF NOT EXISTS ticket_incident_id_idx ON ticket (incident_id);
