\set ON_ERROR_STOP on
DO $$
DECLARE
  v_case_id integer;
  v_invoice_id integer;
  v_other_case integer;
  v_other_invoice integer;
  v_status text;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE relname = 'import_cost_advance_payments') THEN
    RAISE EXCEPTION 'ADVANCE_RLS_NOT_ENABLED';
  END IF;
  INSERT INTO public.import_cost_cases
    (public_id,idempotency_key,business_date,title,created_by_user_id)
  VALUES ('IMP-ADV-1','test-advance-111111','2026-11-09','Supplier advance fixture',1)
  RETURNING id INTO v_case_id;
  INSERT INTO public.import_cost_invoices
    (case_id,line_ref,supplier_id,invoice_number,goods_usd_minor,goods_booked_ils_minor)
  VALUES (v_case_id,'I-ADV',11,'INV-ADV',100000,360000)
  RETURNING id INTO v_invoice_id;

  INSERT INTO public.import_cost_advance_payments
    (case_id,invoice_id,idempotency_key,bank_account_id,business_date,usd_amount_minor,
     spot_rate_micros,bank_book_ils_minor,advance_ils_minor,fx_gain_ils_minor,
     finance_transaction_id,created_by_user_id)
  VALUES (v_case_id,v_invoice_id,'sample-payment-uuid-001',10,'2026-11-09',
    100000,3600000,350000,360000,10000,100,1);

  BEGIN
    INSERT INTO public.import_cost_advance_payments
      (case_id,invoice_id,idempotency_key,bank_account_id,business_date,usd_amount_minor,
       spot_rate_micros,bank_book_ils_minor,advance_ils_minor,fx_gain_ils_minor,created_by_user_id)
    VALUES (v_case_id,v_invoice_id,'sample-payment-uuid-002',10,'2026-11-09',
      100000,3600000,350000,360000,0,1);
    RAISE EXCEPTION 'UNBALANCED_ADVANCE_ACCEPTED';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.import_cost_advance_payments
      (case_id,invoice_id,idempotency_key,bank_account_id,business_date,usd_amount_minor,
       spot_rate_micros,bank_book_ils_minor,advance_ils_minor,fx_gain_ils_minor,created_by_user_id)
    VALUES (v_case_id,v_invoice_id,'sample-payment-uuid-001',10,'2026-11-09',
      100000,3600000,350000,360000,10000,1);
    RAISE EXCEPTION 'DUPLICATE_PAYMENT_KEY_ACCEPTED';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  INSERT INTO public.import_cost_cases
    (public_id,idempotency_key,business_date,title,created_by_user_id)
  VALUES ('IMP-ADV-2','test-advance-222222','2026-11-09','Other import',1)
  RETURNING id INTO v_other_case;
  INSERT INTO public.import_cost_invoices
    (case_id,line_ref,supplier_id,invoice_number,goods_usd_minor,goods_booked_ils_minor)
  VALUES (v_other_case,'I-OTHER',22,'INV-OTHER',100000,360000)
  RETURNING id INTO v_other_invoice;

  BEGIN
    INSERT INTO public.import_cost_advance_payments
      (case_id,invoice_id,idempotency_key,bank_account_id,business_date,usd_amount_minor,
       spot_rate_micros,bank_book_ils_minor,advance_ils_minor,fx_gain_ils_minor,created_by_user_id)
    VALUES (v_case_id,v_other_invoice,'sample-payment-uuid-003',10,'2026-11-09',
      100000,3600000,350000,360000,10000,1);
    RAISE EXCEPTION 'CROSS_CASE_ADVANCE_ACCEPTED';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  BEGIN
    DELETE FROM public.import_cost_invoices WHERE id=v_invoice_id;
    RAISE EXCEPTION 'PAID_SUPPLIER_INVOICE_DELETED';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
END $$;
