-- Ledger integrity, enforced at the database level so no application bug can
-- corrupt the books. The service layer performs the same checks first to give
-- friendly errors; these are the last line of defense.

-- ---------------------------------------------------------------------------
-- 1. Money is always a positive integer; direction carries the sign.
-- ---------------------------------------------------------------------------
ALTER TABLE "journal_lines"
  ADD CONSTRAINT "journal_lines_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "journal_lines"
  ADD CONSTRAINT "journal_lines_functional_amount_positive" CHECK ("functionalAmount" > 0);

-- Exchange rate must be positive.
ALTER TABLE "journal_entries"
  ADD CONSTRAINT "journal_entries_exchange_rate_positive" CHECK ("exchangeRate" > 0);

-- ---------------------------------------------------------------------------
-- 2. Posted journal entries are immutable: no UPDATE, no DELETE.
--    Corrections happen via reversing entries that link back via "reversesId".
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_entry_immutability() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger: posted journal entry % is immutable; post a reversing entry instead', OLD.id
    USING ERRCODE = 'raise_exception';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER journal_entries_immutable
  BEFORE UPDATE OR DELETE ON "journal_entries"
  FOR EACH ROW
  WHEN (OLD.status = 'POSTED')
  EXECUTE FUNCTION enforce_entry_immutability();

-- Entries must be created as DRAFT and pass through the posting check below;
-- inserting a row directly in POSTED state would bypass balance validation.
CREATE OR REPLACE FUNCTION forbid_direct_posted_insert() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger: journal entries must be inserted as DRAFT and posted via status transition';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER journal_entries_no_direct_post
  BEFORE INSERT ON "journal_entries"
  FOR EACH ROW
  WHEN (NEW.status = 'POSTED')
  EXECUTE FUNCTION forbid_direct_posted_insert();

-- Lines of a posted entry are equally frozen (covers INSERT of extra lines,
-- UPDATE, and DELETE).
CREATE OR REPLACE FUNCTION enforce_line_immutability() RETURNS trigger AS $$
DECLARE
  v_entry_id text := COALESCE(NEW."entryId", OLD."entryId");
  v_status "entry_status";
BEGIN
  SELECT status INTO v_status FROM "journal_entries" WHERE id = v_entry_id;
  IF v_status = 'POSTED' THEN
    RAISE EXCEPTION 'ledger: lines of posted journal entry % are immutable', v_entry_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER journal_lines_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON "journal_lines"
  FOR EACH ROW
  EXECUTE FUNCTION enforce_line_immutability();

-- ---------------------------------------------------------------------------
-- 3. Posting gate: an entry may transition DRAFT -> POSTED only if it is
--    balanced (debits = credits in BOTH transaction and functional currency),
--    has at least two lines, and carries an entry number.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_entry_balance() RETURNS trigger AS $$
DECLARE
  v_lines int;
  v_debits numeric;
  v_credits numeric;
  v_fdebits numeric;
  v_fcredits numeric;
BEGIN
  IF OLD.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'ledger: only DRAFT entries can be posted (entry % is %)', OLD.id, OLD.status;
  END IF;
  IF NEW."entryNumber" IS NULL THEN
    RAISE EXCEPTION 'ledger: posted entries must carry an entry number (entry %)', NEW.id;
  END IF;

  SELECT count(*),
         COALESCE(sum(amount)             FILTER (WHERE direction = 'DEBIT'),  0),
         COALESCE(sum(amount)             FILTER (WHERE direction = 'CREDIT'), 0),
         COALESCE(sum("functionalAmount") FILTER (WHERE direction = 'DEBIT'),  0),
         COALESCE(sum("functionalAmount") FILTER (WHERE direction = 'CREDIT'), 0)
    INTO v_lines, v_debits, v_credits, v_fdebits, v_fcredits
    FROM "journal_lines"
   WHERE "entryId" = NEW.id;

  IF v_lines < 2 THEN
    RAISE EXCEPTION 'ledger: entry % needs at least 2 lines to post', NEW.id;
  END IF;
  IF v_debits <> v_credits THEN
    RAISE EXCEPTION 'ledger: entry % is unbalanced (debits % != credits %)', NEW.id, v_debits, v_credits;
  END IF;
  IF v_fdebits <> v_fcredits THEN
    RAISE EXCEPTION 'ledger: entry % is unbalanced in functional currency (debits % != credits %)', NEW.id, v_fdebits, v_fcredits;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER journal_entries_posting_gate
  BEFORE UPDATE ON "journal_entries"
  FOR EACH ROW
  WHEN (NEW.status = 'POSTED' AND OLD.status IS DISTINCT FROM 'POSTED')
  EXECUTE FUNCTION enforce_entry_balance();
