import assert from "node:assert/strict";
import test from "node:test";
import { instagramVerificationToken } from "./instagram-verification-token.ts";

test("current Instagram check keeps using the existing token", () => {
  assert.equal(instagramVerificationToken({
    META_INSTAGRAM_ACCESS_TOKEN: "old-instagram-token",
    META_INSTAGRAM_ACCESS_TOKEN_NEXT: "candidate-instagram-token",
  }), "old-instagram-token");
});

test("new Instagram check uses the candidate only", () => {
  assert.equal(instagramVerificationToken({
    META_INSTAGRAM_ACCESS_TOKEN: "old-instagram-token",
    META_INSTAGRAM_ACCESS_TOKEN_NEXT: " candidate-instagram-token ",
  }, "next"), "candidate-instagram-token");
});

test("new Instagram check never falls back to the existing token", () => {
  assert.equal(instagramVerificationToken({
    META_INSTAGRAM_ACCESS_TOKEN: "old-instagram-token",
  }, "next"), "");
});

test("current Instagram check remains unconfigured if only candidate exists", () => {
  assert.equal(instagramVerificationToken({
    META_INSTAGRAM_ACCESS_TOKEN_NEXT: "candidate-instagram-token",
  }), "");
});

test("empty candidate is never a green result source", () => {
  assert.equal(instagramVerificationToken({
    META_INSTAGRAM_ACCESS_TOKEN: "old-instagram-token",
    META_INSTAGRAM_ACCESS_TOKEN_NEXT: "  ",
  }, "next"), "");
});
