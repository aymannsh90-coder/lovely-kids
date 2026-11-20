import test from "node:test";
import assert from "node:assert/strict";
import { hasAssignedStoryImage } from "./productStoryImageStatus.ts";

test("shows badge and matches assigned filter only for saved Story images", () => {
  assert.equal(hasAssignedStoryImage({storyImage:"https://media.lovelykids.net/media/r2/story.jpg"}), true);
  assert.equal(hasAssignedStoryImage({storyImage:" https://media.lovelykids.net/media/r2/story.jpg "}), true);
});

test("missing and blank Story images have no badge and match missing filter", () => {
  assert.equal(hasAssignedStoryImage({storyImage:null}), false);
  assert.equal(hasAssignedStoryImage({}), false);
  assert.equal(hasAssignedStoryImage({storyImage:""}), false);
  assert.equal(hasAssignedStoryImage({storyImage:" \t  "}), false);
});

test("counts are complementary for the same active product set", () => {
  const products = [
    {id:"1",storyImage:"https://media.lovelykids.net/first.jpg"},
    {id:"2",storyImage:null},
    {id:"3"},
    {id:"4",storyImage:" "},
    {id:"5",storyImage:"https://media.lovelykids.net/second.jpg"},
  ];
  const assigned=products.filter(hasAssignedStoryImage);
  const missing=products.filter(product=>!hasAssignedStoryImage(product));
  assert.deepEqual(assigned.map(p=>p.id),["1","5"]);
  assert.deepEqual(missing.map(p=>p.id),["2","3","4"]);
  assert.equal(assigned.length+missing.length,products.length);
});
