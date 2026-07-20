CREATE TABLE feature_flags (
  key TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  updated_at TEXT NOT NULL
);

INSERT INTO feature_flags (key, enabled, updated_at) VALUES
  ('qq_import', 1, CURRENT_TIMESTAMP),
  ('browser_import_fallback', 1, CURRENT_TIMESTAMP),
  ('post_match_share', 1, CURRENT_TIMESTAMP),
  ('wechat_login', 1, CURRENT_TIMESTAMP),
  ('qq_login', 1, CURRENT_TIMESTAMP);

CREATE TABLE admin_audit_logs (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_admin_audit_created ON admin_audit_logs(created_at DESC);
