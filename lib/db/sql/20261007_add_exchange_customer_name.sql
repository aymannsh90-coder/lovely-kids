-- Store an optional customer name on POS exchange documents.
-- SAFE/ADDITIVE: nullable column, no existing rows rewritten.

ALTER TABLE exchange_documents
ADD COLUMN IF NOT EXISTS customer_name text;
