\set ON_ERROR_STOP on
DO $$
DECLARE
  v_case_id integer;
  v_shipment_id integer;
  v_second_case_id integer;
  v_foreign_shipment integer;
  v_count integer;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE relname='import_cost_direct_payments') THEN
    RAISE EXCEPTION 'DIRECT_PAYMENTS_RLS_DISABLED';
  END IF;
  INSERT INTO public.import_cost_cases
    (public_id,idempotency_key,business_date,title,created_by_user_id)
  VALUES ('IMP-DIR-1','test-direct-payment-001','2026-11-09','Freight',1)
  RETURNING id INTO v_case_id;
  INSERT INTO public.import_cost_shipments
    (case_id,line_ref,freight_ils_minor,customs_ils_minor,local_transport_ils_minor,freight_clearing_ils_minor)
  VALUES (v_case_id,'SHIP-1',3000,2000,1000,6000)
  RETURNING id INTO v_shipment_id;

  INSERT INTO public.import_cost_direct_payments
    (case_id,shipment_id,idempotency_key,cost_type,payment_method,bank_account_id,
     settlement_finance_account_id,business_date,amount_ils_minor,created_by_user_id)
  VALUES (v_case_id,v_shipment_id,'test-direct-0001','freight','bank',10,77,'2026-11-09',3000,1);

  BEGIN
    INSERT INTO public.import_cost_direct_payments
      (case_id,shipment_id,idempotency_key,cost_type,payment_method,bank_account_id,
       settlement_finance_account_id,business_date,amount_ils_minor,created_by_user_id)
    VALUES (v_case_id,v_shipment_id,'test-direct-0002','freight','bank',10,77,'2026-11-09',0,1);
    RAISE EXCEPTION 'ZERO_DIRECT_PAYMENT_ACCEPTED';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.import_cost_direct_payments
      (case_id,shipment_id,idempotency_key,cost_type,payment_method,bank_account_id,cash_session_id,
       settlement_finance_account_id,business_date,amount_ils_minor,created_by_user_id)
    VALUES (v_case_id,v_shipment_id,'test-direct-0003','customs','cash',10,55,77,'2026-11-09',2000,1);
    RAISE EXCEPTION 'TWO_PAYMENT_SOURCES_ACCEPTED';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.import_cost_direct_payments
      (case_id,shipment_id,idempotency_key,cost_type,payment_method,cash_session_id,
       settlement_finance_account_id,business_date,amount_ils_minor,created_by_user_id)
    VALUES (v_case_id,v_shipment_id,'test-direct-0004','travel','cash',55,77,'2026-11-09',1000,1);
    RAISE EXCEPTION 'TRAVEL_ON_SINGLE_SHIPMENT_ACCEPTED';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  INSERT INTO public.import_cost_cases
    (public_id,idempotency_key,business_date,title,created_by_user_id)
  VALUES ('IMP-DIR-2','test-direct-payment-002','2026-11-09','Other import',1)
  RETURNING id INTO v_second_case_id;
  INSERT INTO public.import_cost_shipments
    (case_id,line_ref,freight_ils_minor,customs_ils_minor,local_transport_ils_minor,freight_clearing_ils_minor)
  VALUES (v_second_case_id,'OTHER-1',1000,1000,1000,3000)
  RETURNING id INTO v_foreign_shipment;
  BEGIN
    INSERT INTO public.import_cost_direct_payments
      (case_id,shipment_id,idempotency_key,cost_type,payment_method,bank_account_id,
       settlement_finance_account_id,business_date,amount_ils_minor,created_by_user_id)
    VALUES (v_case_id,v_foreign_shipment,'test-direct-0005','freight','bank',10,77,'2026-11-09',1000,1);
    RAISE EXCEPTION 'CROSS_CASE_SHIPMENT_PAYMENT_ACCEPTED';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  BEGIN
    DELETE FROM public.import_cost_shipments WHERE id=v_shipment_id;
    RAISE EXCEPTION 'PAID_SHIPMENT_DELETED';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
END $$;
