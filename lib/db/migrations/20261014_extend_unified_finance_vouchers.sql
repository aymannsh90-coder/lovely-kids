BEGIN;

-- Unified vouchers foundation.
-- This migration only broadens finance_vouchers document metadata.
-- Existing voucher rows and finance transaction history remain untouched.

ALTER TABLE public.finance_vouchers
  DROP CONSTRAINT IF EXISTS finance_vouchers_type_valid;

ALTER TABLE public.finance_vouchers
  ADD CONSTRAINT finance_vouchers_type_valid
  CHECK (
    voucher_type IN (
      'customer_receipt',
      'expense',
      'employee_advance',
      'employee_repayment',
      'salary_accrual',
      'employee_payment',
      'owner_withdrawal',
      'adjustment',
      'receipt',
      'payment',
      'journal'
    )
  );

ALTER TABLE public.finance_vouchers
  DROP CONSTRAINT IF EXISTS finance_vouchers_party_pair_valid;

ALTER TABLE public.finance_vouchers
  ADD CONSTRAINT finance_vouchers_party_pair_valid
  CHECK (
    (
      party_type IS NULL
      AND party_id IS NULL
    )
    OR
    (
      party_type IN (
        'customer',
        'employee',
        'supplier',
        'delivery_company',
        'owner'
      )
      AND party_id IS NOT NULL
    )
  );

ALTER TABLE public.finance_vouchers
  DROP CONSTRAINT IF EXISTS finance_vouchers_party_type_matches;

ALTER TABLE public.finance_vouchers
  ADD CONSTRAINT finance_vouchers_party_type_matches
  CHECK (
    (
      voucher_type = 'customer_receipt'
      AND party_type = 'customer'
      AND party_id IS NOT NULL
    )
    OR
    (
      voucher_type IN (
        'employee_advance',
        'employee_repayment',
        'salary_accrual',
        'employee_payment'
      )
      AND party_type = 'employee'
      AND party_id IS NOT NULL
    )
    OR
    (
      voucher_type = 'owner_withdrawal'
      AND party_type = 'owner'
      AND party_id IS NOT NULL
    )
    OR
    (
      voucher_type IN ('receipt', 'payment')
      AND party_type IN (
        'customer',
        'employee',
        'supplier',
        'delivery_company'
      )
      AND party_id IS NOT NULL
    )
    OR
    (
      voucher_type = 'journal'
      AND party_type IS NULL
      AND party_id IS NULL
    )
    OR
    (
      voucher_type IN ('expense', 'adjustment')
    )
  );

COMMIT;
