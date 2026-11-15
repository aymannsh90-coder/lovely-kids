-- Integration safety checks after 20261115 migration on an isolated DB.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'deferred_purchase_sale_costs'
      AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'Deferred purchase table must enforce RLS';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.deferred_purchase_sale_costs', 'INSERT')
  THEN
    RAISE EXCEPTION 'Service role lacks INSERT privilege';
  END IF;
  IF has_table_privilege('anon', 'public.deferred_purchase_sale_costs', 'SELECT') OR
     has_table_privilege('authenticated', 'public.deferred_purchase_sale_costs', 'SELECT')
  THEN
    RAISE EXCEPTION 'Public role can read deferred purchase costs';
  END IF;
END $$;

INSERT INTO public.deferred_purchase_sale_costs
  (draft_public_id,product_id,sale_item_id,quantity,status)
VALUES ('DRAFT-TEST-0001',313,7001,1,'pending');

DO $$
DECLARE blocked boolean := false;
BEGIN
  BEGIN
    DELETE FROM public.pos_purchases WHERE id=8;
  EXCEPTION WHEN check_violation THEN
    blocked := true;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'Pending cost sale allowed draft deletion';
  END IF;
END $$;

DO $$
DECLARE blocked boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.deferred_purchase_sale_costs
      (draft_public_id,product_id,sale_item_id,quantity,status)
    VALUES ('DRAFT-TEST-0001',313,7001,1,'pending');
  EXCEPTION WHEN unique_violation THEN
    blocked := true;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'Duplicated pending sale item accepted';
  END IF;
END $$;

UPDATE public.deferred_purchase_sale_costs
  SET status='settled',approved_purchase_id=45
  WHERE sale_item_id=7001;
DELETE FROM public.pos_purchases WHERE id=8;
DELETE FROM public.pos_sale_items WHERE id=7001;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.deferred_purchase_sale_costs
    WHERE sale_item_id=7001 AND status='settled'
      AND approved_purchase_id=45
  ) THEN
    RAISE EXCEPTION 'Settled cost audit was incorrectly deleted';
  END IF;
END $$;
