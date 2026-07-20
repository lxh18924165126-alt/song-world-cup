ALTER TABLE tournaments ADD COLUMN last_event_id TEXT;
ALTER TABLE tournaments ADD COLUMN last_event_sequence INTEGER;

CREATE INDEX idx_tournaments_last_event
  ON tournaments(id, last_event_sequence);
