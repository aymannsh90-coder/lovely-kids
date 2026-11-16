-- Separate from the comprehensive import-cost PR.
-- Non-posting setup: creates only ledger account headers, never journal lines.
-- Import agent = advances held by the shipping agent (not a real bank).
-- Freight in transit = prepayments for freight/clearance until landed-cost reconciliation.
INSERT INTO finance_accounts (code, name, account_type, currency_code, status, notes)
VALUES
  ('IMPORT_AGENT_CLEARING', 'حساب استيراد', 'asset', 'ILS', 'active',
   'عهدة بالشيكل لدى شركة الشحن؛ لا تُنشأ عملة دولار أو بنك وهمي.'),
  ('IMPORT_FREIGHT_IN_TRANSIT', 'شحن وتخليص استيراد قيد التسوية', 'asset', 'ILS', 'active',
   'تكاليف شحن وتخليص دُفعت لشركة الشحن وتنتظر الربط بتكلفة فاتورة شراء معتمدة.')
ON CONFLICT (code) DO NOTHING;
