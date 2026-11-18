import assert from "node:assert/strict";
import test from "node:test";
import {
  instagramNextStoryPilotReady,
  validateInstagramNextStoryProductId,
  validInstagramStoryPhotoUrl,
} from "./instagram-next-story-pilot.ts";

test("pilot must explicitly enable its OWN flag with NEXT token and exact numeric account", () => {
  const ready = {
    META_INSTAGRAM_STORIES_NEXT_PILOT_ENABLED:"true",
    META_INSTAGRAM_ACCOUNT_ID:"17841411928735926",
    META_INSTAGRAM_ACCESS_TOKEN_NEXT:" candidate ",
  };
  assert.equal(instagramNextStoryPilotReady(ready),true);
  for(const value of ["false","TRUE","1",undefined])
    assert.equal(instagramNextStoryPilotReady({...ready,META_INSTAGRAM_STORIES_NEXT_PILOT_ENABLED:value}),false);
  assert.equal(instagramNextStoryPilotReady({...ready,META_INSTAGRAM_ACCESS_TOKEN_NEXT:undefined}),false);
  assert.equal(instagramNextStoryPilotReady({...ready,META_INSTAGRAM_ACCOUNT_ID:"no"}),false);
});

test("legacy Instagram Story token, feed flag and carousel flag can never activate NEXT pilot", () => {
  assert.equal(instagramNextStoryPilotReady({
    META_INSTAGRAM_ACCOUNT_ID:"17841411928735926",
    META_INSTAGRAM_ACCESS_TOKEN_NEXT:undefined,
    META_INSTAGRAM_STORIES_NEXT_PILOT_ENABLED:"true",
    META_INSTAGRAM_ACCESS_TOKEN:"old",
    META_INSTAGRAM_FEED_USE_NEXT_TOKEN:"true",
    META_INSTAGRAM_CAROUSEL_ENABLED:"true",
    META_INSTAGRAM_STORIES_USE_NEXT_TOKEN:"true",
  }),false);
});

test("pilot rejects non-numeric or multi-product selections", () => {
  assert.equal(validateInstagramNextStoryProductId(616),616);
  for(const val of [0,-1,1.5,"616",null,[616],[],{},Number.MAX_SAFE_INTEGER+1]){
    assert.equal(validateInstagramNextStoryProductId(val),null);
  }
});

test("pilot accepts only public HTTPS JPEG paths (not a square-image converter)", () => {
  assert.equal(validInstagramStoryPhotoUrl("https://media.lovelykids.net/media/r2/p.jpg"),true);
  assert.equal(validInstagramStoryPhotoUrl("https://media.lovelykids.net/media/r2/p.JPEG"),true);
  for(const v of ["http://cdn.example.com/p.jpg","https://cdn.example.com/p.png",
    "https://user:pass@cdn.example.com/p.jpg","/relative.jpg","https://cdn.example.com/p.jpg.png","javascript:alert(1)"]){
    assert.equal(validInstagramStoryPhotoUrl(v),false);
  }
});
