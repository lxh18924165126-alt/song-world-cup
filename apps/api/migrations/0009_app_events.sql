CREATE TABLE app_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  subject_id TEXT,
  payload_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL
);

CREATE INDEX idx_app_events_type_occurred ON app_events(type, occurred_at DESC);
