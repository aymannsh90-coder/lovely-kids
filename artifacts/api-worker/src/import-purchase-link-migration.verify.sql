\set ON_ERROR_STOP on
DO $$
DECLARE
  v_case_id integer;
  v_allocation integer;
  v_other_case integer;
  v_other_allocation integer;
  v_invoice integer;
  v_shipment integer;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE relname='import_cost_purchase_links') THEN
    RAISE EXCEPTION 'PURCHASE_LINK_RLS_NOT_ENABLED';
  END IF;
  INSERT INTO public.import_cost_cases
    (public_id,idempotency_key,business_date,title,created_by_user_id)
  VALUES ('IMP-LINK-1','import-case-link-first','2026-11-09','Cost linkage',1)
  RETURNING id INTO v_case_id;
  INSERT INTO public.import_cost_invoices
    (case_id,line_ref,supplier_id,invoice_number,goods_usd_minor,goods_booked_ils_minor)
  VALUES (v_case_id,'I-LINK-1',11,'SUPP-100',10000,35000)
  RETURNING id INTO v_invoice;
  INSERT INTO public.import_cost_shipments
    (case_id,line_ref,freight_ils_minor,customs_ils_minor,local_transport_ils_minor,freight_clearing_ils_minor)
  VALUES (v_case_id,'S-LINK-1',1000,1000,0,2000)
  RETURNING id INTO v_shipment;
  INSERT INTO public.import_cost_allocations
    (case_id,line_ref,invoice_id,shipment_id,goods_ils_minor,freight_ils_minor,excel_landed_ils_minor)
  VALUES (v_case_id,'L-LINK-1',v_invoice,v_shipment,35000,2000,37000)
  RETURNING id INTO v_allocation;

  INSERT INTO public.import_cost_purchase_links
    (case_id,allocation_id,purchase_id,created_by_user_id)
  VALUES (v_case_id,v_allocation,1001,1);

  BEGIN
    INSERT INTO public.import_cost_purchase_links
      (case_id,allocation_id,purchase_id,created_by_user_id)
    VALUES (v_case_id,v_allocation,1001,1);
    RAISE EXCEPTION 'PURCHASE_LINK_DUPLICATION_ACCEPTED';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  INSERT INTO public.import_cost_cases
    (public_id,idempotency_key,business_date,title,created_by_user_id)
  VALUES ('IMP-LINK-2','import-case-link-other','2026-11-09','Other import',1)
  RETURNING id INTO v_other_case;
  INSERT INTO public.import_cost_invoices
    (case_id,line_ref,supplier_id,invoice_number,goods_usd_minor,goods_booked_ils_minor)
  VALUES (v_other_case,'I-LINK-2',22,'SUPP-200',10000,35000)
  RETURNING id INTO v_invoice;
  INSERT INTO public.import_cost_shipments
    (case_id,line_ref,freight_ils_minor,customs_ils_minor,local_transport_ils_minor,freight_clearing_ils_minor)
  VALUES (v_other_case,'S-LINK-2',0,0,0,0)
  RETURNING id INTO v_shipment;
  INSERT INTO public.import_cost_allocations
    (case_id,line_ref,invoice_id,shipment_id,goods_ils_minor,freight_ils_minor,excel_landed_ils_minor)
  VALUES (v_other_case,'L-LINK-2',v_invoice,v_shipment,35000,0,35000)
  RETURNING id INTO v_other_allocation;

  BEGIN
    INSERT INTO public.import_cost_purchase_links
      (case_id,allocation_id,purchase_id,created_by_user_id)
    VALUES (v_case_id,v_other_allocation,1002,1);
    RAISE EXCEPTION 'CROSS_CASE_PURCHASE_LINK_ACCEPTED';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  BEGIN
    DELETE FROM public.import_cost_allocations WHERE id=v_allocation;
    RAISE EXCEPTION 'LINKED_COST_GROUP_DELETED';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    DELETE FROM public.pos_purchases WHERE id=1001;
    RAISE EXCEPTION 'LINKED_POSTED_PURCHASE_DELETED';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
END $$;
