-- Lovely Kids: defend bank ledger currency metadata at the database boundary.
-- Existing finance amounts and original transactions are never modified.
-- A complete missing ILS metadata triple is reconstructed from the base ILS
-- journal line; partial/inconsistent values are rejected, not guessed.
-- This is safe to reapply and intentionally does not create a bank movement.

CREATE OR REPLACE FUNCTION public.lk_guard_bank_ledger_currency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  account_currency text;
  base_minor bigint;
  reproduced_base_minor bigint;
BEGIN
  SELECT b.currency_code INTO account_currency
  FROM public.bank_accounts b
  WHERE b.finance_account_id = NEW.account_id
  LIMIT 1;

  -- Other chart-of-account lines are not bank account lines.
  IF account_currency IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.debit_minor > 0 AND NEW.credit_minor = 0 THEN
    base_minor := NEW.debit_minor;
  ELSIF NEW.credit_minor > 0 AND NEW.debit_minor = 0 THEN
    base_minor := NEW.credit_minor;
  ELSE
    RAISE EXCEPTION 'Bank journal line must have exactly one positive side'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.currency_code IS NULL
     AND NEW.currency_amount_minor IS NULL
     AND NEW.exchange_rate_micros IS NULL
     AND account_currency = 'ILS'
  THEN
    NEW.currency_code := 'ILS';
    NEW.currency_amount_minor := base_minor::integer;
    NEW.exchange_rate_micros := 1000000;
  END IF;

  IF NEW.currency_code IS DISTINCT FROM account_currency
     OR NEW.currency_amount_minor IS NULL
     OR NEW.exchange_rate_micros IS NULL
     OR NEW.currency_amount_minor <= 0
     OR NEW.exchange_rate_micros <= 0
  THEN
    RAISE EXCEPTION 'Bank ledger currency metadata missing or mismatched (account id %)', NEW.account_id
      USING ERRCODE = '23514';
  END IF;

  IF account_currency = 'ILS' THEN
    IF NEW.exchange_rate_micros <> 1000000
       OR NEW.currency_amount_minor::bigint <> base_minor
    THEN
      RAISE EXCEPTION 'ILS bank ledger amount must equal base amount at rate 1 (account id %)', NEW.account_id
        USING ERRCODE = '23514';
    END IF;
  ELSE
    reproduced_base_minor := (
      NEW.currency_amount_minor::bigint * NEW.exchange_rate_micros::bigint + 500000
    ) / 1000000;
    IF reproduced_base_minor <> base_minor THEN
      RAISE EXCEPTION 'Foreign bank ledger amount/rate does not match base amount (account id %)', NEW.account_id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lk_guard_bank_ledger_currency_trigger
ON public.finance_transaction_lines;

CREATE TRIGGER lk_guard_bank_ledger_currency_trigger
BEFORE INSERT OR UPDATE OF
  account_id, debit_minor, credit_minor,
  currency_code, currency_amount_minor, exchange_rate_micros
ON public.finance_transaction_lines
FOR EACH ROW
EXECUTE FUNCTION public.lk_guard_bank_ledger_currency();
