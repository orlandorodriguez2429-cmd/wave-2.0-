-- Data retention: a business can be deleted as a whole (its Plaid items are
-- removed first and a deletion record is kept). Posted ledger rows are
-- otherwise immutable; the triggers below now allow DELETE — never UPDATE —
-- only inside a transaction that has set
--   SET LOCAL app.business_deletion = 'on'
-- which only src/lib/retention.ts does.

CREATE OR REPLACE FUNCTION enforce_entry_immutability() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.business_deletion', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'ledger: posted journal entry % is immutable; post a reversing entry instead', OLD.id
    USING ERRCODE = 'raise_exception';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION enforce_line_immutability() RETURNS trigger AS $$
DECLARE
  v_entry_id text := COALESCE(NEW."entryId", OLD."entryId");
  v_status "entry_status";
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.business_deletion', true) = 'on' THEN
    RETURN OLD;
  END IF;
  SELECT status INTO v_status FROM "journal_entries" WHERE id = v_entry_id;
  IF v_status = 'POSTED' THEN
    RAISE EXCEPTION 'ledger: lines of posted journal entry % are immutable', v_entry_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
