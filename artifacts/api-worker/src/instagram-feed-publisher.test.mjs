import assert from "node:assert/strict";
import test from "node:test";
import { publishInstagramSinglePhoto, safeInstagramFeedError } from "./instagram-feed-publisher.ts";
const ig="17841411928735926";
const img="https://example.com/image.jpg";

test("single photo stages, checks finished, publishes once, and fetches permalink", async () => {
  const original=globalThis.fetch;const calls=[];
  globalThis.fetch=async (url, init) => {
    const s=String(url);calls.push({s,init});
    assert.equal(init.headers.Authorization,"Bearer private-next-token");
    if(s.endsWith("/media")){const body=new URLSearchParams(init.body);assert.equal(body.get("image_url"),img);assert.equal(body.get("caption"),"caption");assert.equal(body.has("media_type"),false);return Response.json({id:"11122"});}
    if(s.includes("/11122?fields=status_code"))return Response.json({status_code:"FINISHED"});
    if(s.endsWith("/media_publish")){assert.equal(new URLSearchParams(init.body).get("creation_id"),"11122");return Response.json({id:"33344"});}
    if(s.endsWith("/33344?fields=permalink"))return Response.json({permalink:"https://www.instagram.com/p/TEST/"});
    throw Error("Unexpected API call: "+s);
  };
  try{
    assert.deepEqual(await publishInstagramSinglePhoto(ig,"private-next-token",img,"caption"),{mediaId:"33344",permalink:"https://www.instagram.com/p/TEST/"});
    assert.equal(calls.filter(x=>x.s.endsWith("/media_publish")).length,1);
    assert.ok(calls.every(x=>!x.s.includes("private-next-token")));
  }finally{globalThis.fetch=original}
});

test("never publishes while media remains in progress", async () => {
  const original=globalThis.fetch;let statuses=0,publishes=0,delays=0;
  globalThis.fetch=async url => {
    if(String(url).endsWith("/media"))return Response.json({id:"111"});
    if(String(url).includes("?fields=status_code")){statuses++;return Response.json({status_code:"IN_PROGRESS"})}
    publishes++;throw Error("must not publish");
  };
  try{
    await assert.rejects(publishInstagramSinglePhoto(ig,"token",img,"caption",async ms=>{assert.equal(ms,4000);delays++;}),/IG_FEED_NOT_READY/);
    assert.equal(statuses,6);assert.equal(delays,5);assert.equal(publishes,0);
  }finally{globalThis.fetch=original}
});

test("Meta failure shows numeric diagnostics only", async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async()=>Response.json({error:{code:190,error_subcode:463,message:"private-secret"}},{status:401});
  try{
    await assert.rejects(publishInstagramSinglePhoto(ig,"private-secret",img,"caption"),e=>{
      assert.equal(safeInstagramFeedError(e),"IG_FEED_META_190_463");
      assert.ok(!safeInstagramFeedError(e).includes("private-secret"));return true;
    });
  }finally{globalThis.fetch=original}
});

test("if published permalink lookup fails, do not retry publishing",async()=>{
  const original=globalThis.fetch;let publishCount=0;
  globalThis.fetch=async url => {
    const s=String(url);
    if(s.endsWith("/media"))return Response.json({id:"111"});
    if(s.includes("status_code"))return Response.json({status_code:"FINISHED"});
    if(s.endsWith("/media_publish")){publishCount++;return Response.json({id:"222"})}
    if(s.includes("permalink"))return Response.json({error:{code:10}},{status:403});
    throw Error("Unexpected");
  };
  try{
    assert.deepEqual(await publishInstagramSinglePhoto(ig,"token",img,"caption"),{mediaId:"222",permalink:null});
    assert.equal(publishCount,1);
  }finally{globalThis.fetch=original}
});
