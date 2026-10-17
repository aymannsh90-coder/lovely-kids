BEGIN;

ALTER TABLE public.assistant_drafts
  ADD COLUMN transfer_direction text,
  ADD COLUMN finance_transaction_id integer
    REFERENCES public.finance_transactions(id)
    ON DELETE RESTRICT;

ALTER TABLE public.assistant_drafts
  DROP CONSTRAINT assistant_drafts_intent_valid;

ALTER TABLE public.assistant_drafts
  ADD CONSTRAINT assistant_drafts_intent_valid
  CHECK (
    intent IS NULL
    OR intent IN (
      'expense',
      'employee_advance',
      'owner_withdrawal',
      'finance_transfer'
    )
  );

ALTER TABLE public.assistant_drafts
  ADD CONSTRAINT assistant_drafts_transfer_direction_valid
  CHECK (
    transfer_direction IS NULL
    OR transfer_direction IN (
      'cash_to_bank',
      'bank_to_cash'
    )
  );

ALTER TABLE public.assistant_drafts
  ADD CONSTRAINT assistant_drafts_transfer_scope_valid
  CHECK (
    transfer_direction IS NULL
    OR intent = 'finance_transfer'
  );

ALTER TABLE public.assistant_drafts
  DROP CONSTRAINT assistant_drafts_review_state_valid;

ALTER TABLE public.assistant_drafts
  ADD CONSTRAINT assistant_drafts_review_state_valid
  CHECK (
    (
      status = 'pending'
      AND finance_voucher_id IS NULL
      AND finance_transaction_id IS NULL
      AND reviewed_by_user_id IS NULL
      AND reviewed_at IS NULL
    )
    OR
    (
      status = 'approved'
      AND reviewed_by_user_id IS NOT NULL
      AND reviewed_at IS NOT NULL
      AND intent IS NOT NULL
      AND amount_minor IS NOT NULL
      AND (
        (
          intent = 'finance_transfer'
          AND finance_voucher_id IS NULL
          AND finance_transaction_id IS NOT NULL
          AND transfer_direction IS NOT NULL
          AND bank_account_id IS NOT NULL
          AND employee_id IS NULL
          AND expense_category_id IS NULL
        )
        OR
        (
          intent <> 'finance_transfer'
          AND finance_voucher_id IS NOT NULL
          AND finance_transaction_id IS NULL
          AND transfer_direction IS NULL
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
      )
    )
    OR
    (
      status = 'rejected'
      AND finance_voucher_id IS NULL
      AND finance_transaction_id IS NULL
      AND reviewed_by_user_id IS NOT NULL
      AND reviewed_at IS NOT NULL
    )
  );

CREATE UNIQUE INDEX assistant_drafts_finance_transaction_idx
  ON public.assistant_drafts(finance_transaction_id)
  WHERE finance_transaction_id IS NOT NULL;

COMMIT;
