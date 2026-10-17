BEGIN;

ALTER TABLE public.assistant_drafts
  ADD COLUMN bank_account_id integer
    REFERENCES public.bank_accounts(id)
    ON DELETE RESTRICT;

ALTER TABLE public.assistant_drafts
  DROP CONSTRAINT assistant_drafts_payment_method_valid;

ALTER TABLE public.assistant_drafts
  ADD CONSTRAINT assistant_drafts_payment_method_valid
  CHECK (payment_method IN ('cash', 'bank'));

ALTER TABLE public.assistant_drafts
  ADD CONSTRAINT assistant_drafts_payment_scope_valid
  CHECK (
    (
      payment_method = 'cash'
      AND bank_account_id IS NULL
    )
    OR
    payment_method = 'bank'
  );

ALTER TABLE public.assistant_drafts
  DROP CONSTRAINT assistant_drafts_review_state_valid;

ALTER TABLE public.assistant_drafts
  ADD CONSTRAINT assistant_drafts_review_state_valid
  CHECK (
    (
      status = 'pending'
      AND finance_voucher_id IS NULL
      AND reviewed_by_user_id IS NULL
      AND reviewed_at IS NULL
    )
    OR
    (
      status = 'approved'
      AND finance_voucher_id IS NOT NULL
      AND reviewed_by_user_id IS NOT NULL
      AND reviewed_at IS NOT NULL
      AND intent IS NOT NULL
      AND amount_minor IS NOT NULL
      AND (
        (
          payment_method = 'cash'
          AND bank_account_id IS NULL
        )
        OR
        (
          payment_method = 'bank'
          AND bank_account_id IS NOT NULL
        )
      )
      AND (
        (
          intent = 'employee_advance'
          AND employee_id IS NOT NULL
          AND expense_category_id IS NULL
        )
        OR
        (
          intent = 'expense'
          AND expense_category_id IS NOT NULL
          AND employee_id IS NULL
        )
        OR
        (
          intent = 'owner_withdrawal'
          AND employee_id IS NULL
          AND expense_category_id IS NULL
        )
      )
    )
    OR
    (
      status = 'rejected'
      AND finance_voucher_id IS NULL
      AND reviewed_by_user_id IS NOT NULL
      AND reviewed_at IS NOT NULL
    )
  );

CREATE INDEX assistant_drafts_bank_account_idx
  ON public.assistant_drafts(bank_account_id);

COMMIT;
