-- Add "spend X and choose one gift" as a first-class promotion kind.
-- Keeps all promotion types in the existing central promotion engine.

ALTER TABLE promotions
  ADD COLUMN IF NOT EXISTS spend_threshold_minor integer;

ALTER TABLE promotions
  DROP CONSTRAINT IF EXISTS promotions_kind_valid;

ALTER TABLE promotions
  ADD CONSTRAINT promotions_kind_valid
  CHECK (
    kind IN (
      'buy_x_get_y',
      'percent_off',
      'bundle_price',
      'spend_x_get_gift'
    )
  );

ALTER TABLE promotions
  DROP CONSTRAINT IF EXISTS promotions_spend_x_get_gift_valid;

ALTER TABLE promotions
  ADD CONSTRAINT promotions_spend_x_get_gift_valid
  CHECK (
    kind <> 'spend_x_get_gift'
    OR (
      spend_threshold_minor IS NOT NULL
      AND spend_threshold_minor > 0
      AND reward_quantity = 1
      AND reward_mode = 'free'
      AND reward_selection_mode = 'customer_choice'
    )
  );
