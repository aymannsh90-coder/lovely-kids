BEGIN;

ALTER TABLE products
ADD COLUMN IF NOT EXISTS auto_hidden_out_of_stock boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION product_has_available_stock(
  p_stock integer,
  p_color_variants jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  has_sizes boolean := false;
  has_available_size boolean := false;
BEGIN
  IF jsonb_typeof(p_color_variants) = 'array'
     AND jsonb_array_length(p_color_variants) > 0 THEN

    SELECT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_color_variants) AS variant
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(variant->'sizes') = 'array'
          THEN variant->'sizes'
          ELSE '[]'::jsonb
        END
      ) AS size_entry
    )
    INTO has_sizes;

    IF has_sizes THEN
      SELECT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_color_variants) AS variant
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(variant->'sizes') = 'array'
            THEN variant->'sizes'
            ELSE '[]'::jsonb
          END
        ) AS size_entry
        WHERE COALESCE((size_entry->>'outOfStock')::boolean, false) = false
          AND (
            NOT (size_entry ? 'stock')
            OR size_entry->'stock' IS NULL
            OR size_entry->'stock' = 'null'::jsonb
            OR (
              jsonb_typeof(size_entry->'stock') = 'number'
              AND (size_entry->>'stock')::numeric > 0
            )
          )
      )
      INTO has_available_size;

      RETURN has_available_size;
    END IF;
  END IF;

  RETURN p_stock IS NULL OR p_stock > 0;
END;
$$;

CREATE OR REPLACE FUNCTION sync_product_stock_visibility()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF product_has_available_stock(NEW.stock, NEW.color_variants) THEN

    -- نظهره فقط إذا كان النظام نفسه أخفاه بسبب نفاد المخزون
    IF NEW.auto_hidden_out_of_stock = true THEN
      NEW.is_hidden := false;
      NEW.auto_hidden_out_of_stock := false;
    END IF;

  ELSE

    -- إذا كان ظاهرًا ونفدت كل الكمية، نخفيه تلقائيًا
    IF NEW.is_hidden = false THEN
      NEW.is_hidden := true;
      NEW.auto_hidden_out_of_stock := true;
    END IF;

  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_product_stock_visibility_insert ON products;
CREATE TRIGGER trg_product_stock_visibility_insert
BEFORE INSERT ON products
FOR EACH ROW
EXECUTE FUNCTION sync_product_stock_visibility();

DROP TRIGGER IF EXISTS trg_product_stock_visibility_update ON products;
CREATE TRIGGER trg_product_stock_visibility_update
BEFORE UPDATE OF stock, color_variants, is_hidden, auto_hidden_out_of_stock
ON products
FOR EACH ROW
EXECUTE FUNCTION sync_product_stock_visibility();

-- إخفاء المنتجات المنتهية الموجودة حاليًا، بدون لمس المخفي يدويًا
UPDATE products
SET
  is_hidden = true,
  auto_hidden_out_of_stock = true
WHERE is_hidden = false
  AND product_has_available_stock(stock, color_variants) = false;

COMMIT;
