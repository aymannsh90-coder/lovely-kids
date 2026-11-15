# Owner photo stories: Facebook Page + Instagram Business

## Scope and separation

Adds an optional Stories block to the existing `/admin/facebook-posts` owner-only page. Existing Facebook multi-photo feed publishing, catalog/CAPI, ads, delivery, POS and product records remain unchanged.

- Select 1–10 distinct visible products from existing admin list.
- Choose Facebook Page, Instagram account, or both.
- `POST /api/owner/stories/preview` re-reads the authoritative DB and shows exact images, names and product URLs **without calling Meta**.
- `POST /api/owner/stories/publish` requires owner authentication **and** `confirmed: true`, checks all target configurations before any write, and publishes each product as an **individual story** per target, sequentially.
- Facebook: `POST /{PAGE_ID}/photos` (`published=false`), then `POST /{PAGE_ID}/photo_stories` (`photo_id`).
- Instagram Business with Unified/Facebook Login: `POST /{IG_ID}/media` (`media_type=STORIES`, `image_url`), `GET /{container_id}?fields=status_code`, then (only if FINISHED) `POST /{IG_ID}/media_publish`.
- Tokens are server-only Cloudflare secrets. FB Page token is derived from `META_FACEBOOK_SYSTEM_USER_ACCESS_TOKEN` using the existing resolver. IG uses existing `META_INSTAGRAM_ACCESS_TOKEN` and `META_INSTAGRAM_ACCOUNT_ID` only.
- No automatic retry or repost when API results are uncertain. Server returns successes already accepted and where it stopped. Owner must inspect each Page / account before retrying to avoid duplicates.

## Product media and limitations

This feature submits **the original public HTTPS product image**. It does not synthesize 9:16 JPGs, add branding, overlay text, or rewrite files. Instagram can reject PNG/WEBP/unsupported dimensions; preferred story assets are public JPEGs, portrait 9:16. Do **not** claim a story preview has identical cropping to Meta.

A product URL in a preview is for owner reference and is **not** a clickable link sticker. Meta's Content Publishing API does not offer story link stickers in this integration. A Page photo story also does not automatically display the product caption as story artwork.

Instagram's initial credential identity verification is read-only and does **not** prove access to publishing. Some accounts, permissions and API modes will reject stories. Both target channels require a real, explicitly authorized owner test before calling the feature production-verified.

No publish was performed as part of this PR or testing. Before enabling widespread use, owner should test a single JPEG story on Facebook, then a single Instagram Business story, and confirm each appears.

## Authentication / safety

- Reject anonymous and non-owner requests.
- Validate product IDs, target deduplication, and images; server rechecks hidden/deleted status.
- Do not log, return or append any token to the frontend.
- Return only numeric Meta error codes/subcodes; never raw Meta error payloads.
- Stop immediately upon failure. Response includes `published`, optional `failed`, and duplicate-warning text.
- UI blocks immediate repeat from one attempted publish.

## Sources

- Meta API documentation / Postman: https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api
- Meta Page Photo reference: https://developers.facebook.com/docs/graph-api/reference/photo/
- Meta Page Stories: https://developers.facebook.com/docs/pages-api/posts/photo-stories

## Tests

```bash
pnpm --filter @workspace/api-worker typecheck
node --experimental-strip-types --test artifacts/api-worker/src/owner-story-meta-publish.test.mjs
pnpm --filter @workspace/lovely-kids typecheck
```

Do not merge or deploy without successful CI. Never make a test post automatically.
