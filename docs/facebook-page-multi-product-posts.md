# Facebook Page: Multi-product Organic Post Composer

This feature adds an owner-only page under **Admin → النشر على فيسبوك**.
It is **separate** from the pre-existing Meta catalog feed (`/api/meta/catalog.csv`) and CAPI/ads.

## Intended UX

1. Owner selects 1–10 distinct existing visible products.
2. The server regenerates photo captions and main post text from the database.
3. The owner previews the photos and per-model title/link, and can change the introduction.
4. The owner explicitly confirms before publishing.
5. The API creates an unpublished photo with its **own caption** for every selected model, then creates one Facebook Page multi-photo feed post using `attached_media[n]`.

Per-photo Arabic text (exact, for each product):
```
<exact Arabic product name in store>
لمشاهدة هذا الموديل على متجرنا الإلكتروني والتعرّف على النمر والألوان المتوفرة، ادخلي على رابط الموديل 👇
https://lovelykids.net/product/<product id>
```
The same blocks are included in the **main post message** because Facebook decides how individual photo captions appear within a multi-image post. We cannot guarantee that each caption appears directly below a collage thumbnail; users may need to open the individual photo.

## Required credentials (not added to this repo)

Store these ONLY in the Cloudflare Worker runtime secrets/vars, never in frontend or git:

- `META_FACEBOOK_PAGE_ID`: Numeric Facebook Page ID
- `META_FACEBOOK_PAGE_ACCESS_TOKEN`: Page access token with publishing permissions

The Page token must represent the correct Page and have **pages_manage_posts**, plus the Page/permissions required by Meta for API publishing (e.g., `pages_read_engagement`, `pages_show_list`, `CREATE_CONTENT` Page task). These are **not** the catalog feed or Conversions API token by assumption. Verify Meta app approval and Page role/access before use. Keep existing Meta catalog credentials untouched.

Endpoint `GET /api/owner/facebook/status` only exposes a boolean `configured`, never tokens.

## Endpoints / security

- `POST /api/owner/facebook/preview`: Owner-only canonical caption and photo preview.
- `POST /api/owner/facebook/publish`: Owner-only; creates unpublished photos + publishes Page post.
- Auth: existing bearer authentication and server-side `isOwner` check.
- Validates selection and image HTTPS, re-fetches latest product names/visibility on server.
- No writes to product inventory, online orders, Meta catalog, ad campaigns or existing tables.
- No publication on test/preview; only an explicit confirmed publish calls Meta.

If Meta returns an ambiguous timeout after some uploads, the owner sees a warning to check the Page before retrying; an automatic retry risks duplicate posts. For production-grade high-volume use consider a persisted idempotency key and a publishing log.

## References

- https://developers.facebook.com/docs/graph-api/reference/page/feed/
- https://developers.facebook.com/docs/graph-api/reference/photo/
- https://developers.facebook.com/docs/graph-api/guides/versioning

## Testing

```bash
pnpm --filter @workspace/api-worker typecheck
node --experimental-strip-types --test artifacts/api-worker/src/facebook-post-composer.test.mjs
pnpm --filter @workspace/lovely-kids typecheck
pnpm --filter @workspace/lovely-kids build
```

Do not run a real publish against the shop Page without explicit confirmation, valid Page token and verification that the preview is correct.
