import test from "node:test";
import assert from "node:assert/strict";
import worker, { renderProductPreviewHtml } from "./product-share-worker.mjs";

const shell = '<html><head><title>Lovely Kids</title><meta name="description" content="main"><meta property="og:image" content="https://lovelykids.net/store.jpg"><meta property="og:title" content="Store"><meta name="twitter:image" content="https://lovelykids.net/store.jpg"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>';
const product = {
  id: "597",
  nameAr: 'طقم & <جميل> "بيبي"',
  description: "لبس أطفال ناعم",
  price: 50,
  image: "https://media.lovelykids.net/media/r2/product.jpg",
};

test("product preview replaces only OG metadata and keeps app shell", () => {
  const html = renderProductPreviewHtml(shell, product, "597");
  assert.match(html, /og:image" content="https:\/\/media\.lovelykids\.net\/media\/r2\/product\.jpg"/);
  assert.match(html, /og:url" content="https:\/\/lovelykids\.net\/product\/597"/);
  assert.match(html, /السعر: 50 ₪/);
  assert.match(html, /طقم &amp;.*&quot;بيبي&quot;/);
  assert.ok(!html.includes('content="https://lovelykids.net/store.jpg"'));
  assert.match(html, /<script src="\/bundle.js"><\/script>/);
  assert.equal((html.match(/property="og:image"/g) || []).length, 1);
});

test("rejects unsafe external image and escaped injection", () => {
  const html = renderProductPreviewHtml(shell, {
    ...product,
    image: "https://bad.example/pic.png",
    nameAr: '"><script>alert(1)</script>',
    description: "<script>foo</script>",
  }, "597");
  assert.match(html, /og:image" content="https:\/\/www\.lovelykids\.net\/og-image-v3\.jpg/);
  assert.ok(!html.includes("<script>alert(1)</script>"));
});

test("edge fetch returns product metadata and falls back without breaking site", async () => {
  const originalFetch = globalThis.fetch;
  const fetched = [];
  globalThis.fetch = async () => new Response(JSON.stringify([product]), { status: 200 });
  const env = { ASSETS: { fetch: async (req) => {
    fetched.push(new URL(req.url).pathname);
    return new Response(shell, {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  } } };
  try {
    const res = await worker.fetch(new Request("https://lovelykids.net/product/597"), env);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /media\/r2\/product\.jpg/);
    assert.deepEqual(fetched, ["/"]);

    const other = await worker.fetch(new Request("https://lovelykids.net/offers"), env);
    assert.equal(other.status, 200);
    assert.deepEqual(fetched, ["/", "/offers"]);

    globalThis.fetch = async () => new Response("{}", { status: 503 });
    const errorResponse = await worker.fetch(
      new Request("https://lovelykids.net/product/597"), env,
    );
    assert.equal(await errorResponse.text(), shell);
    assert.deepEqual(fetched, ["/", "/offers", "/product/597"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
