-- Check new ledger tables, foreign keys, quality constraints and two new movement types.
DO $$
BEGIN
  IF to_regclass('public.pos_purchase_returns') IS NULL OR to_regclass('public.pos_purchase_return_items') IS NULL THEN
    RAISE EXCEPTION 'Purchase return migration failed to create ledger tables';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_purchase_returns_void_state_valid') THEN
    RAISE EXCEPTION 'Missing cancellation-state constraint';
  END IF;
END $$;

INSERT INTO public.users(id) VALUES (1);
INSERT INTO public.suppliers(id) VALUES (1);
INSERT INTO public.products(id) VALUES (10);
INSERT INTO public.pos_purchases(id) VALUES (11);
INSERT INTO public.pos_purchase_items(id) VALUES (12);

INSERT INTO public.pos_purchase_returns(public_id,idempotency_key,purchase_id,supplier_id,business_date,refund_amount_minor,inventory_cost_minor,reason,created_by_user_id)
VALUES ('PRET-TEST-1','purchase-return:test:1',11,1,'2026-11-03',400,400,'test return',1);
INSERT INTO public.pos_purchase_return_items(return_id,purchase_item_id,product_id,color,size,quantity,refund_amount_minor,inventory_cost_minor,cost_quality)
VALUES (1,12,10,'أبيض','3-6',2,200,200,'confirmed'),
       (1,12,10,'زهري','6-9',2,200,200,'confirmed');
INSERT INTO public.inventory_movements(movement_type,source_type)
VALUES ('purchase_return','pos_purchase_return'), ('purchase_return_void','pos_purchase_return');
INSERT INTO public.product_cost_ledger(event_type)
VALUES ('purchase_return'), ('purchase_return_void');

DO $$
BEGIN
  IF (SELECT SUM(quantity) FROM public.pos_purchase_return_items WHERE return_id = 1) <> 4 THEN
    RAISE EXCEPTION 'Partial return quantity mismatch';
  END IF;
  IF (SELECT SUM(refund_amount_minor) FROM public.pos_purchase_return_items WHERE return_id = 1) <> 400 THEN
    RAISE EXCEPTION 'Purchase return value mismatch';
  END IF;
  IF (SELECT COUNT(*) FROM public.inventory_movements WHERE source_type='pos_purchase_return') <> 2 THEN
    RAISE EXCEPTION 'Purchase stock-card event constraints invalid';
  END IF;
END $$;

-- Explicitly verify invalid data cannot bypass schema checks.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.pos_purchase_return_items(return_id,purchase_item_id,product_id,quantity,refund_amount_minor,inventory_cost_minor,cost_quality)
    VALUES (1,12,10,-1,100,100,'confirmed');
    RAISE EXCEPTION 'Negative quantity accepted';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.pos_purchase_returns(public_id,idempotency_key,purchase_id,supplier_id,business_date,refund_amount_minor,inventory_cost_minor,reason,created_by_user_id)
    VALUES ('PRET-TEST-2','purchase-return:test:1',11,1,'2026-11-03',400,400,'duplicate',1);
    RAISE EXCEPTION 'Duplicate idempotency accepted';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;

  BEGIN
    UPDATE public.pos_purchase_returns SET status='voided' WHERE id=1;
    RAISE EXCEPTION 'Unexplained void accepted';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END $$;

UPDATE public.pos_purchase_returns
  SET status='voided',voided_at=now(),voided_by_user_id=1,void_reason='test cancel' WHERE id=1;
DO $$
BEGIN
  IF (SELECT status FROM public.pos_purchase_returns WHERE id=1) <> 'voided' THEN
    RAISE EXCEPTION 'Void state failed';
  END IF;
END $$;
