-- analytics/schema.sql
-- Tabla única de eventos para el dashboard. B la corre al arrancar el API.
-- kinds: recall_detected | patient_matched | bulletin_generated | alert_sent
CREATE TABLE IF NOT EXISTS events (
  ts DateTime DEFAULT now(),
  kind LowCardinality(String),
  payload String
) ENGINE = MergeTree
ORDER BY (kind, ts);
