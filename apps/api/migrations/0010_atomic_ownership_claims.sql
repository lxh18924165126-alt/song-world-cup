CREATE TABLE ownership_claim_operations (
  id TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expected_access_token_hash TEXT NOT NULL,
  replacement_access_token_hash TEXT NOT NULL,
  replacement_draft_token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TRIGGER validate_ownership_claim
BEFORE INSERT ON ownership_claim_operations
WHEN NOT EXISTS (
  SELECT 1 FROM tournaments
  WHERE id = NEW.tournament_id
    AND owner_account_id IS NULL
    AND access_token_hash = NEW.expected_access_token_hash
)
BEGIN
  SELECT RAISE(ABORT, 'ownership_claim_conflict');
END;

CREATE TRIGGER apply_ownership_claim
AFTER INSERT ON ownership_claim_operations
BEGIN
  UPDATE tournaments
  SET owner_account_id = NEW.account_id,
      access_token_hash = NEW.replacement_access_token_hash,
      updated_at = NEW.created_at
  WHERE id = NEW.tournament_id;

  UPDATE tournament_drafts
  SET restore_token_hash = NEW.replacement_draft_token_hash,
      updated_at = NEW.created_at
  WHERE id = (SELECT draft_id FROM tournaments WHERE id = NEW.tournament_id);
END;
