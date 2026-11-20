-- Optional product-specific portrait JPEG for Facebook and Instagram Stories.
-- Safe additive migration: existing product photos, variants, inventory and
-- accounting are unchanged; older API Workers can continue to run.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS story_image text;

COMMENT ON COLUMN public.products.story_image IS
  'Optional dedicated 9:16 image used for social Stories only; normal product images and feed posts remain unchanged.';
