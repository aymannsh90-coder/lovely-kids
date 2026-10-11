BEGIN;

-- Add party dimensions to journal lines without rewriting historical entries.
-- Existing per-party GL accounts remain valid for legacy transactions.
-- New postings can gradually move to shared control accounts plus these party IDs.

ALTER TABLE public.finance_transaction_lines
  ADD COLUMN IF NOT EXISTS customer_id integer;

ALTER TABLE public.finance_transaction_lines
  ADD COLUMN IF NOT EXISTS employee_id integer;

ALTER TABLE public.finance_transaction_lines
  ADD COLUMN IF NOT EXISTS supplier_id integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'finance_transaction_lines_customer_id_fkey'
      AND conrelid = 'public.finance_transaction_lines'::regclass
  ) THEN
    ALTER TABLE public.finance_transaction_lines
      ADD CONSTRAINT finance_transaction_lines_customer_id_fkey
      FOREIGN KEY (customer_id)
      REFERENCES public.customers(id)
      ON DELETE RESTRICT;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'finance_transaction_lines_employee_id_fkey'
      AND conrelid = 'public.finance_transaction_lines'::regclass
  ) THEN
    ALTER TABLE public.finance_transaction_lines
      ADD CONSTRAINT finance_transaction_lines_employee_id_fkey
      FOREIGN KEY (employee_id)
      REFERENCES public.employees(id)
      ON DELETE RESTRICT;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'finance_transaction_lines_supplier_id_fkey'
      AND conrelid = 'public.finance_transaction_lines'::regclass
  ) THEN
    ALTER TABLE public.finance_transaction_lines
      ADD CONSTRAINT finance_transaction_lines_supplier_id_fkey
      FOREIGN KEY (supplier_id)
      REFERENCES public.suppliers(id)
      ON DELETE RESTRICT;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'finance_transaction_lines_single_party'
      AND conrelid = 'public.finance_transaction_lines'::regclass
  ) THEN
    ALTER TABLE public.finance_transaction_lines
      ADD CONSTRAINT finance_transaction_lines_single_party
      CHECK (
        num_nonnulls(
          customer_id,
          employee_id,
          supplier_id
        ) <= 1
      );
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS finance_transaction_lines_customer_idx
  ON public.finance_transaction_lines(customer_id)
  WHERE customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS finance_transaction_lines_employee_idx
  ON public.finance_transaction_lines(employee_id)
  WHERE employee_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS finance_transaction_lines_supplier_idx
  ON public.finance_transaction_lines(supplier_id)
  WHERE supplier_id IS NOT NULL;

-- Shared control accounts for new postings.
-- Legacy per-party accounts stay untouched and continue to support history.
INSERT INTO public.finance_accounts (
  code,
  name,
  account_type,
  linked_entity_type,
  linked_entity_id,
  currency_code,
  status,
  notes
)
VALUES
  (
    'CUSTOMER_RECEIVABLE_CONTROL',
    'ذمم الزبائن - حساب رقابي',
    'asset',
    NULL,
    NULL,
    'ILS',
    'active',
    'Control account for customer receivables; party identity is stored on finance transaction lines.'
  ),
  (
    'EMPLOYEE_ADVANCE_CONTROL',
    'سلف الموظفين - حساب رقابي',
    'asset',
    NULL,
    NULL,
    'ILS',
    'active',
    'Control account for employee advances; employee identity is stored on finance transaction lines.'
  ),
  (
    'SUPPLIER_PAYABLE_CONTROL',
    'ذمم الموردين - حساب رقابي',
    'liability',
    NULL,
    NULL,
    'ILS',
    'active',
    'Control account for supplier payables; supplier identity is stored on finance transaction lines.'
  ),
  (
    'EMPLOYEE_PAYABLE_CONTROL',
    'مستحقات الموظفين - حساب رقابي',
    'liability',
    NULL,
    NULL,
    'ILS',
    'active',
    'Control account for employee payables; employee identity is stored on finance transaction lines.'
  )
ON CONFLICT (code) DO NOTHING;

DO $
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.finance_accounts
    WHERE
      (code = 'CUSTOMER_RECEIVABLE_CONTROL' AND account_type <> 'asset')
      OR (code = 'EMPLOYEE_ADVANCE_CONTROL' AND account_type <> 'asset')
      OR (code = 'SUPPLIER_PAYABLE_CONTROL' AND account_type <> 'liability')
      OR (code = 'EMPLOYEE_PAYABLE_CONTROL' AND account_type <> 'liability')
  ) THEN
    RAISE EXCEPTION
      'Control account code exists with an unexpected account_type';
  END IF;
END
$;

COMMIT;
