import assert from "node:assert/strict";
import test from "node:test";

import {
  interfolioApplicationId,
  interfolioApplicationUrl,
} from "../lib/interfolio-position.js";

test("prefers Interfolio's public legacy_position_id over its internal row id", () => {
  const record = {
    id: 190006,
    legacy_position_id: 191827,
    name: "Faculty - All Ranks - All Surgical Specialities",
  };

  assert.equal(interfolioApplicationId(record), "191827");
  assert.equal(interfolioApplicationUrl(record), "https://apply.interfolio.com/191827");
});

test("falls back to id for older Interfolio feeds", () => {
  assert.equal(interfolioApplicationUrl({ id: 12345 }), "https://apply.interfolio.com/12345");
  assert.equal(interfolioApplicationUrl({}), null);
});
