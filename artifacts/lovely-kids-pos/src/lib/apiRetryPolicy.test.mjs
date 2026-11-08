import assert from "node:assert/strict";
import test from "node:test";
import {
  API_READ_MAX_ATTEMPTS,
  apiReadRetryDelayMs,
  canRetryApiRead,
} from "./apiRetryPolicy.ts";

test("only transient GET failures get retry attempts", () => {
  for (const status of [502, 503, 504]) {
    assert.equal(canRetryApiRead("GET", 0, status), true);
    assert.equal(canRetryApiRead("GET", 1, status), true);
  }
  assert.equal(canRetryApiRead("GET", 0), true);
  for (const status of [400, 401, 403, 404, 408, 429, 500]) {
    assert.equal(canRetryApiRead("GET", 0, status), false);
  }
});

test("never replay writes, even on network errors", () => {
  for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
    assert.equal(canRetryApiRead(method, 0), false);
    assert.equal(canRetryApiRead(method, 0, 503), false);
  }
});

test("bounded retry count and backoff", () => {
  assert.equal(API_READ_MAX_ATTEMPTS, 3);
  assert.equal(canRetryApiRead("GET", 2, 503), false);
  assert.equal(canRetryApiRead("GET", 5), false);
  for (const [attempt, min, max] of [[0, 350, 499], [1, 700, 849]]) {
    const delay = apiReadRetryDelayMs(attempt);
    assert.ok(delay >= min && delay <= max, String(delay));
  }
});
