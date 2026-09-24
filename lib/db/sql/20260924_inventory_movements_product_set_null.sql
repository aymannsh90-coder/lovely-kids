BEGIN;

ALTER TABLE public.inventory_movements
  DROP CONSTRAINT inventory_movements_product_id_fkey;

ALTER TABLE public.inventory_movements
  ALTER COLUMN product_id DROP NOT NULL;

ALTER TABLE public.inventory_movements
  ADD CONSTRAINT inventory_movements_product_id_fkey
  FOREIGN KEY (product_id)
  REFERENCES public.products(id)
  ON DELETE SET NULL;

COMMIT;
