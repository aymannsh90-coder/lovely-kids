import assert from "node:assert/strict";
import test from "node:test";
import {publishInstagramCarousel,safeCarouselError} from "./instagram-carousel-publisher.ts";
const ig="17841411928735926";
const urls=["https://media.lovelykids.net/one.jpg","https://media.lovelykids.net/two.jpg"];
const json=(data,status=200)=>Response.json(data,{status});

test("carousel stages both images in order, checks status, creates parent then publishes once",async()=>{
  const old=globalThis.fetch, log=[];let child=0;
  globalThis.fetch=async (url,init)=>{
    const s=String(url), body=init.body?new URLSearchParams(init.body):new URLSearchParams();
    log.push({s,init,body});
    assert.equal(init.headers.Authorization,"Bearer token-next");
    if(s.endsWith("/media")&&body.has("image_url")){
      child++;
      assert.equal(body.get("image_url"),urls[child-1]);
      assert.equal(body.get("is_carousel_item"),"true");
      return json({id:String(100+child)});
    }
    if(s.endsWith("/media")&&body.get("media_type")==="CAROUSEL"){
      assert.equal(body.get("children"),"101,102");assert.equal(body.get("caption"),"Lovely Kids");
      return json({id:"103"});
    }
    if(s.includes("?fields=status_code"))return json({status_code:"FINISHED"});
    if(s.endsWith("/media_publish")){assert.equal(body.get("creation_id"),"103");return json({id:"104"})}
    if(s.endsWith("104?fields=permalink"))return json({permalink:"https://www.instagram.com/p/TEST/"});
    throw Error("unexpected "+s);
  };
  try{
    assert.deepEqual(await publishInstagramCarousel(ig,"token-next",urls,"Lovely Kids"),{mediaId:"104",permalink:"https://www.instagram.com/p/TEST/"});
    assert.equal(log.filter(v=>v.s.endsWith("/media_publish")).length,1);
    assert.ok(log.every(v=>!v.s.includes("token-next")));
  }finally{globalThis.fetch=old}
});

test("never publishes when one child cannot finish",async()=>{
  const old=globalThis.fetch;let child=0,publish=0;
  globalThis.fetch=async (url,init)=>{
    const s=String(url),p=init.body?new URLSearchParams(init.body):new URLSearchParams();
    if(s.endsWith("/media")&&p.has("image_url"))return json({id:String(++child)});
    if(s.includes("?fields=status_code"))return json({status_code:s.includes("/2?")?"ERROR":"FINISHED"});
    publish++; throw Error("must not publish");
  };
  try{
    await assert.rejects(publishInstagramCarousel(ig,"token",urls,"caption"),/IG_CAROUSEL_MEDIA_FAILED/);
    assert.equal(publish,0);
  }finally{globalThis.fetch=old}
});

test("invalid image count is rejected before any fetch",async()=>{
  const old=globalThis.fetch;
  globalThis.fetch=async()=>{throw Error("should not fetch")};
  try{
    await assert.rejects(publishInstagramCarousel(ig,"token",["https://a"],"caption"),/BAD_INPUT/);
    await assert.rejects(publishInstagramCarousel(ig,"token",Array(11).fill("https://a"),"caption"),/BAD_INPUT/);
  }finally{globalThis.fetch=old}
});

test("never retries publication if fetching permalink fails",async()=>{
  const old=globalThis.fetch;let child=0,publish=0;
  globalThis.fetch=async(url,init)=>{
    const s=String(url),p=init.body?new URLSearchParams(init.body):new URLSearchParams();
    if(s.endsWith("/media")&&p.has("image_url"))return json({id:String(++child)});
    if(s.includes("?fields=status_code"))return json({status_code:"FINISHED"});
    if(s.endsWith("/media")&&p.get("media_type")==="CAROUSEL")return json({id:"3"});
    if(s.endsWith("/media_publish")){publish++;return json({id:"4"})}
    if(s.includes("permalink"))return json({error:{code:190} },403);
    throw Error("unexpected "+s);
  };
  try{
    assert.deepEqual(await publishInstagramCarousel(ig,"token",urls,"caption"),{mediaId:"4",permalink:null});
    assert.equal(publish,1);
  }finally{globalThis.fetch=old}
});

test("Meta exceptions contain numeric codes but never leaked message or token",async()=>{
  const old=globalThis.fetch;
  globalThis.fetch=async()=>json({error:{code:190,error_subcode:463,message:"secret token"}},401);
  try{
    await assert.rejects(publishInstagramCarousel(ig,"secret token",urls,"caption"),error=>{
      assert.equal(safeCarouselError(error),"IG_CAROUSEL_META_190_463");
      return true;
    });
  }finally{globalThis.fetch=old}
});
