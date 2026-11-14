-- 0006_ticket_resolution.sql — результат работ инженера и время решения.
ALTER TABLE ticket ADD COLUMN IF NOT EXISTS resolution text;
ALTER TABLE ticket ADD COLUMN IF NOT EXISTS resolved_at timestamptz;
