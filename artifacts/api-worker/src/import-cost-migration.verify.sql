\set ON_ERROR_STOP on
DO $$
DECLARE
  v_case_id integer;
  invoice_id integer;
  shipment_id integer;
  v_second_case_id integer;
  v_second_invoice_id integer;
  has_rls boolean;
  n integer;
BEGIN
  SELECT count(*) INTO n
  FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
  WHERE ns.nspname='public'
    AND c.relname IN ('import_cost_cases','import_cost_invoices','import_cost_shipments','import_cost_allocations')
    AND c.relrowsecurity = true;
  IF n <> 4 THEN RAISE EXCEPTION 'IMPORT_RLS_NOT_ENABLED: %', n; END IF;

  INSERT INTO public.import_cost_cases
    (public_id,idempotency_key,business_date,title,with_travel,travel_recorded_ils_minor,created_by_user_id)
  VALUES ('IMP-CI-1','import-ci-case-000001','2026-11-09','CI Trip',true,10000,1)
  RETURNING id INTO v_case_id;

  INSERT INTO public.import_cost_invoices
    (case_id,line_ref,supplier_id,invoice_number,goods_usd_minor,goods_booked_ils_minor)
  VALUES (v_case_id,'I1',11,'S-1',12000,45000)
  RETURNING id INTO invoice_id;

  INSERT INTO public.import_cost_shipments
    (case_id,line_ref,tracking_number,freight_ils_minor,customs_ils_minor,local_transport_ils_minor,freight_clearing_ils_minor)
  VALUES (v_case_id,'S1','TRACK',5000,4000,1000,10000)
  RETURNING id INTO shipment_id;

  INSERT INTO public.import_cost_allocations
    (case_id,line_ref,invoice_id,shipment_id,goods_ils_minor,freight_ils_minor,travel_managerial_ils_minor,travel_capitalizable_ils_minor,excel_landed_ils_minor)
  VALUES (v_case_id,'L1',invoice_id,shipment_id,45000,10000,10000,0,65000);

  IF (SELECT count(*) FROM public.import_cost_allocations WHERE case_id = v_case_id) <> 1 THEN
    RAISE EXCEPTION 'ALLOCATION_NOT_INSERTED';
  END IF;

  BEGIN
    INSERT INTO public.import_cost_allocations
      (case_id,line_ref,invoice_id,shipment_id,goods_ils_minor,freight_ils_minor,travel_managerial_ils_minor,travel_capitalizable_ils_minor,excel_landed_ils_minor)
    VALUES (v_case_id,'L2',invoice_id,shipment_id,45000,10000,10000,0,66000);
    RAISE EXCEPTION 'BAD_EXCEL_SUM_WAS_ACCEPTED';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.import_cost_shipments
      (case_id,line_ref,freight_ils_minor,customs_ils_minor,local_transport_ils_minor,freight_clearing_ils_minor)
    VALUES (v_case_id,'S2',2000,3000,4000,1000);
    RAISE EXCEPTION 'BAD_SHIPPING_SUM_WAS_ACCEPTED';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.import_cost_invoices
      (case_id,line_ref,supplier_id,invoice_number,goods_usd_minor,goods_booked_ils_minor)
    VALUES (v_case_id,'I1',22,'S-2',12000,45000);
    RAISE EXCEPTION 'DUPLICATE_INVOICE_REF_WAS_ACCEPTED';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.import_cost_cases
      (public_id,idempotency_key,business_date,title,with_travel,travel_recorded_ils_minor,created_by_user_id)
    VALUES ('IMP-CI-2','import-ci-case-000002','2026-11-09','No Trip',false,100,1);
    RAISE EXCEPTION 'INVALID_TRAVEL_WAS_ACCEPTED';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  INSERT INTO public.import_cost_cases
    (public_id,idempotency_key,business_date,title,with_travel,travel_recorded_ils_minor,created_by_user_id)
  VALUES ('IMP-CI-3','import-ci-case-000003','2026-11-09','Separate import',false,0,1)
  RETURNING id INTO v_second_case_id;
  INSERT INTO public.import_cost_invoices
    (case_id,line_ref,supplier_id,invoice_number,goods_usd_minor,goods_booked_ils_minor)
  VALUES (v_second_case_id,'FOREIGN-INVOICE',22,'OTHER',1000,3500)
  RETURNING id INTO v_second_invoice_id;
  BEGIN
    INSERT INTO public.import_cost_allocations
      (case_id,line_ref,invoice_id,shipment_id,goods_ils_minor,freight_ils_minor,travel_managerial_ils_minor,travel_capitalizable_ils_minor,excel_landed_ils_minor)
    VALUES (v_case_id,'CROSS-CASE',v_second_invoice_id,shipment_id,1000,0,0,0,1000);
    RAISE EXCEPTION 'CROSS_CASE_COST_WAS_ACCEPTED';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  DELETE FROM public.import_cost_cases WHERE id = v_second_case_id;

  DELETE FROM public.import_cost_cases WHERE id = v_case_id;
  IF EXISTS (SELECT 1 FROM public.import_cost_invoices WHERE id = invoice_id)
    OR EXISTS (SELECT 1 FROM public.import_cost_shipments WHERE id = shipment_id)
    OR EXISTS (SELECT 1 FROM public.import_cost_allocations WHERE id = 1) THEN
    RAISE EXCEPTION 'DRAFT_CHILD_CASCADE_FAILED';
  END IF;
END $$;
