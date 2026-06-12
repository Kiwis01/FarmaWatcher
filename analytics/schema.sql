-- analytics/schema.sql
-- Dueño: Persona A. Persona B solo LEE esta tabla para el dashboard.
-- Ejecutar una vez contra la instancia de ClickHouse (CLICKHOUSE_URL).

CREATE TABLE IF NOT EXISTS events (
  ts      DateTime,
  kind    LowCardinality(String),
  payload String
) ENGINE = MergeTree
ORDER BY (kind, ts);

-- kinds emitidos por el worker (apps/worker):
--   recall_detected | patient_matched | bulletin_generated | alert_sent
