-- analytics/schema.sql (dueño A; B solo lee para el dashboard)
CREATE TABLE events (
  ts DateTime, kind LowCardinality(String), payload String
) ENGINE = MergeTree ORDER BY (kind, ts);
-- kinds: recall_detected | patient_matched | alert_sent | bulletin_published | paid_request

CREATE TABLE paid_requests (
  ts DateTime, route String, price_usdc Decimal(10,6),
  payer_wallet String, tx_hash String, latency_ms UInt32
) ENGINE = MergeTree ORDER BY ts;
