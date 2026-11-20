\set ON_ERROR_STOP on
DO $$
DECLARE
  id1 integer;
  id2 integer;
  close_id integer;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE relname='import_cost_closures') THEN
    RAISE EXCEPTION 'CLOSURE_RLS_NOT_ENABLED';
  END IF;
  INSERT INTO public.import_cost_cases
    (public_id,idempotency_key,business_date,title,created_by_user_id)
  VALUES ('IMP-CLOSE-CI-1','import-closing-ci-case-1','2026-11-09','Closing fixture',1)
  RETURNING id INTO id1;
  UPDATE public.import_cost_cases SET status='closed' WHERE id=id1;
  IF NOT EXISTS (SELECT 1 FROM public.import_cost_cases
                 WHERE id=id1 AND status='closed') THEN
    RAISE EXCEPTION 'CLOSING_STATUS_UPDATE_FAILED';
  END IF;
  INSERT INTO public.import_cost_closures
    (case_id,idempotency_key,status,business_date,debit_ils_minor,closed_by_user_id,plan_hash)
  VALUES (id1,'closing-key-00000001','posted','2026-11-09',0,1,repeat('a',64))
  RETURNING id INTO close_id;

  BEGIN
    INSERT INTO public.import_cost_closures
      (case_id,idempotency_key,status,business_date,debit_ils_minor,closed_by_user_id,plan_hash)
    VALUES (id1,'closing-key-00000002','posted','2026-11-09',100,1,repeat('a',64));
    RAISE EXCEPTION 'DUPLICATE_LIVE_CLOSURE_ACCEPTED';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.import_cost_closures
      (case_id,idempotency_key,status,business_date,debit_ils_minor,closed_by_user_id,plan_hash)
    VALUES (id1,'closing-key-00000001','posted','2026-11-09',100,1,repeat('a',64));
    RAISE EXCEPTION 'DUPLICATE_CLOSE_KEY_ACCEPTED';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  BEGIN
    UPDATE public.import_cost_closures SET status='reversed'
    WHERE id=close_id;
    RAISE EXCEPTION 'UNJUSTIFIED_REVERSAL_ACCEPTED';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  UPDATE public.import_cost_closures SET
    status='reversed',reversal_key='reverse-closing-key-1',
    reversal_reason='Test reversal on isolated PostgreSQL',reversal_business_date='2026-11-09',
    reversed_at=now(),reversed_by_user_id=1
  WHERE id=close_id;
  UPDATE public.import_cost_cases SET status='draft' WHERE id=id1;
  INSERT INTO public.import_cost_closures
    (case_id,idempotency_key,status,business_date,debit_ils_minor,closed_by_user_id,plan_hash)
  VALUES (id1,'closing-key-00000003','posted','2026-11-09',0,1,repeat('a',64));

  BEGIN
    INSERT INTO public.import_cost_closures
      (case_id,idempotency_key,status,business_date,debit_ils_minor,closed_by_user_id,plan_hash)
    VALUES (id1,'closing-key-00000004','pending','2026-11-09',0,1,repeat('a',64));
    RAISE EXCEPTION 'INVALID_CLOSURE_STATUS_ACCEPTED';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    UPDATE public.import_cost_cases SET status='voided' WHERE id=id1;
    RAISE EXCEPTION 'INVALID_IMPORT_STATUS_ACCEPTED';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
