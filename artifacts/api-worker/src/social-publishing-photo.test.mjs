import assert from "node:assert/strict";
import test from "node:test";
import { socialPublishingQuantity, socialPublishingPhoto, socialPublishingStoryPhoto } from "./social-publishing-photo.ts";

const make = (counts, images = ["https://cdn.example.com/one.jpg", "https://cdn.example.com/two.jpg", "https://cdn.example.com/three.jpg"]) => ({
  image: "https://cdn.example.com/main.jpg",
  stock: counts.reduce((n,v) => n+v,0),
  colorVariants: counts.map((n,i)=>({ color: ["أزرق","زهري","أبيض"][i], image: images[i], sizes:[{size:"3-6",stock:n}] })),
});

test("all available colors keeps original main picture",()=>{
 assert.equal(socialPublishingPhoto(make([1,2,3])),"https://cdn.example.com/main.jpg");
 assert.equal(socialPublishingPhoto(make([0,2,3])),"https://cdn.example.com/main.jpg");
});
test("one remaining available color picks its existing image",()=>{
 assert.equal(socialPublishingPhoto(make([0,2,0])),"https://cdn.example.com/two.jpg");
 assert.equal(socialPublishingPhoto(make([0,0,1])),"https://cdn.example.com/three.jpg");
});
test("unknown size stock and absent color image fall back to main",()=>{
 const p=make([0,3,0]);
 p.colorVariants[0].sizes[0].stock=null;
 assert.equal(socialPublishingPhoto(p),"https://cdn.example.com/main.jpg");
 assert.equal(socialPublishingPhoto(make([0,3,0],["https://cdn.example.com/a.jpg","", "https://cdn.example.com/c.jpg"])),"https://cdn.example.com/main.jpg");
});
test("invalid web image or non-JPEG photo falls back safely",()=>{
 const p=make([0,1,0],["https://cdn.example.com/a.jpg","https://cdn.example.com/one.webp","https://cdn.example.com/c.jpg"]);
 assert.equal(socialPublishingPhoto(p, url => url.endsWith(".jpg")),"https://cdn.example.com/main.jpg");
 assert.equal(socialPublishingPhoto(make([0,1,0],["https://cdn.example.com/a.jpg","http://cdn.example.com/b.jpg","https://cdn.example.com/c.jpg"])),"https://cdn.example.com/main.jpg");
});
test("effective stock matches POS (minimum of tracked totals)",()=>{
 assert.equal(socialPublishingQuantity(make([0,1,2])),3);
 assert.equal(socialPublishingQuantity({...make([0,1,2]),stock:0}),0);
 assert.equal(socialPublishingQuantity({...make([0,1,2]),stock:null}),3);
 assert.equal(socialPublishingQuantity({...make([0,1,2]),stock:null,colorVariants:[]}),null);
 assert.equal(socialPublishingQuantity(make([0,0,0])),0);
});

test("Story publisher prefers dedicated vertical image over default or single available color", () => {
 const p={...make([0,2,0]),storyImage:"https://media.lovelykids.net/media/r2/story.jpg"};
 const valid=url=>url.startsWith("https://")&&url.endsWith(".jpg");
 assert.equal(socialPublishingStoryPhoto(p,valid),p.storyImage);
 assert.equal(socialPublishingPhoto(p,valid),"https://cdn.example.com/two.jpg");
});

test("Story fallback remains identical to existing product/color logic when no dedicated image", () => {
 const p=make([0,2,0]);
 const valid=url=>url.startsWith("https://")&&url.endsWith(".jpg");
 assert.equal(socialPublishingStoryPhoto(p,valid),"https://cdn.example.com/two.jpg");
 assert.equal(socialPublishingStoryPhoto({...p,storyImage:null},valid),"https://cdn.example.com/two.jpg");
 assert.equal(socialPublishingStoryPhoto({...p,storyImage:"https://cdn.example.com/bad.webp"},valid),"https://cdn.example.com/two.jpg");
 assert.equal(socialPublishingStoryPhoto({...make([1,2,0]),storyImage:""},valid),"https://cdn.example.com/main.jpg");
});
