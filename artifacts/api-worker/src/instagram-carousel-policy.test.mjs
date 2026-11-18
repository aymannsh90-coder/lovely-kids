import assert from "node:assert/strict";
import test from "node:test";
import {parseCarouselIds, composeInstagramCarouselCaption, instagramCarouselReady, validCarouselImageUrl} from "./instagram-carousel-policy.ts";

test("carousel allows 2–10 unique positive product IDs, preserves order", () => {
  assert.deepEqual(parseCarouselIds([16,7]), [16,7]);
  assert.equal(parseCarouselIds([5]), null);
  assert.equal(parseCarouselIds(Array.from({length:11},(_,i)=>i+1)), null);
  assert.equal(parseCarouselIds([2,2]), null);
  assert.equal(parseCarouselIds(["2",3]), null);
  assert.equal(parseCarouselIds([2,0]), null);
});

test("carousel caption includes every product name and corresponding URL in selected order",()=>{
  const caption=composeInstagramCarouselCaption([
    {id:616,nameAr:"الأول",name:null,image:"https://media.lovelykids.net/a.jpg"},
    {id:623,nameAr:"الثاني",name:null,image:"https://media.lovelykids.net/b.jpg"},
  ]);
  assert.ok(caption.includes("الأول\nhttps://lovelykids.net/product/616"));
  assert.ok(caption.includes("الثاني\nhttps://lovelykids.net/product/623"));
  assert.ok(caption.indexOf("/616")<caption.indexOf("/623"));
});

test("carousel caption refuses overflow rather than silently omit a product",()=>{
  assert.throws(()=>composeInstagramCarouselCaption([
    {id:1,nameAr:"x".repeat(1800),name:null,image:"https://a.example/x.jpg"},
    {id:2,nameAr:"x".repeat(1800),name:null,image:"https://a.example/y.jpg"},
  ]),/INSTAGRAM_CAPTION_TOO_LONG/);
});

test("images require absolute HTTPS URLs without embedded credentials",()=>{
  assert.equal(validCarouselImageUrl("https://media.lovelykids.net/a.jpg"),true);
  for (const x of ["http://media.lovelykids.net/a.jpg","javascript:alert(1)","/local.jpg","https://user:pass@example.com/i.jpg"]) assert.equal(validCarouselImageUrl(x),false);
});

test("carousel is independently OFF until explicit true with existing feed NEXT enabled",()=>{
  const ok={META_INSTAGRAM_CAROUSEL_ENABLED:"true",META_INSTAGRAM_FEED_USE_NEXT_TOKEN:"true",META_INSTAGRAM_ACCOUNT_ID:"17841411928735926",META_INSTAGRAM_ACCESS_TOKEN_NEXT:"secret"};
  assert.equal(instagramCarouselReady({...ok,META_INSTAGRAM_CAROUSEL_ENABLED:"false"}),false);
  assert.equal(instagramCarouselReady({...ok,META_INSTAGRAM_CAROUSEL_ENABLED:undefined}),false);
  assert.equal(instagramCarouselReady({...ok,META_INSTAGRAM_FEED_USE_NEXT_TOKEN:"false"}),false);
  assert.equal(instagramCarouselReady({...ok,META_INSTAGRAM_ACCESS_TOKEN_NEXT:undefined}),false);
  assert.equal(instagramCarouselReady(ok),true);
});
