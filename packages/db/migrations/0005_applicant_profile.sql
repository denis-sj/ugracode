-- 0005_applicant_profile.sql — профиль заявителя и его техника (задача 025).
-- Модуль `applicant-profile`: предзаполнение места в обращении. Идемпотентно.

CREATE TABLE IF NOT EXISTS applicant_profile (
  user_id text PRIMARY KEY,
  building text,
  floor text,
  cabinet text,
  equipment_id text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS applicant_equipment (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  equipment_id text NOT NULL,
  note text
);

CREATE INDEX IF NOT EXISTS applicant_equipment_user_id_idx ON applicant_equipment (user_id);
