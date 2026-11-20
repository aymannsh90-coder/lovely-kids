\set ON_ERROR_STOP on
DO $$
DECLARE
  one_case integer; other_case integer;
  one_invoice integer; other_invoice integer;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE relname='import_cost_supplier_voucher_claims') THEN
    RAISE EXCEPTION 'VOUCHER_CLAIMS_RLS_NOT_ENABLED';
  END IF;
  INSERT INTO public.import_cost_cases
    (public_id,idempotency_key,business_date,title,created_by_user_id)
  VALUES ('IMP-VC-1','import-voucher-claim-1','2026-11-09','First import',1)
  RETURNING id INTO one_case;
  INSERT INTO public.import_cost_cases
    (public_id,idempotency_key,business_date,title,created_by_user_id)
  VALUES ('IMP-VC-2','import-voucher-claim-2','2026-11-09','Second import',1)
  RETURNING id INTO other_case;
  INSERT INTO public.import_cost_invoices
    (case_id,line_ref,supplier_id,invoice_number,goods_usd_minor,goods_booked_ils_minor)
  VALUES (one_case,'I-VC-1',11,'V-1',2000,7200) RETURNING id INTO one_invoice;
  INSERT INTO public.import_cost_invoices
    (case_id,line_ref,supplier_id,invoice_number,goods_usd_minor,goods_booked_ils_minor)
  VALUES (other_case,'I-VC-2',22,'V-2',2000,7200) RETURNING id INTO other_invoice;
  INSERT INTO public.import_cost_supplier_voucher_claims
    (case_id,invoice_id,voucher_id,amount_ils_minor,created_by_user_id)
  VALUES (one_case,one_invoice,201,3000,1);
  INSERT INTO public.import_cost_supplier_voucher_claims
    (case_id,invoice_id,voucher_id,amount_ils_minor,created_by_user_id)
  VALUES (other_case,other_invoice,201,1200,1);
  -- Deliberate split voucher across invoices is permitted; runtime ensures sum <= actual voucher.
  BEGIN
    INSERT INTO public.import_cost_supplier_voucher_claims
      (case_id,invoice_id,voucher_id,amount_ils_minor,created_by_user_id)
    VALUES (one_case,one_invoice,201,1,1);
    RAISE EXCEPTION 'DUPLICATE_INVOICE_VOUCHER_CLAIM_ACCEPTED';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.import_cost_supplier_voucher_claims
      (case_id,invoice_id,voucher_id,amount_ils_minor,created_by_user_id)
    VALUES (one_case,other_invoice,202,100,1);
    RAISE EXCEPTION 'CROSS_CASE_VOUCHER_CLAIM_ACCEPTED';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.import_cost_supplier_voucher_claims
      (case_id,invoice_id,voucher_id,amount_ils_minor,created_by_user_id)
    VALUES (one_case,one_invoice,202,0,1);
    RAISE EXCEPTION 'ZERO_VOUCHER_CLAIM_ACCEPTED';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    DELETE FROM public.import_cost_invoices WHERE id=one_invoice;
    RAISE EXCEPTION 'ALLOCATED_SUPPLIER_INVOICE_DELETED';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    DELETE FROM public.finance_vouchers WHERE id=201;
    RAISE EXCEPTION 'ALLOCATED_FINANCE_VOUCHER_DELETED';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
END $$;
