import { test } from "node:test";
import assert from "node:assert/strict";
import { institutionMetadataOverride } from "../lib/institution-metadata-overrides.js";

test("curated metadata overrides cover ambiguous and system-level labels", () => {
  assert.deepEqual(institutionMetadataOverride("Bethany College (WV)"), {
    state: "WV",
    control: "private nonprofit",
    level: "4-year",
  });
  assert.deepEqual(institutionMetadataOverride("los angeles ccd"), {
    state: "CA",
    control: "public",
    level: "2-year",
  });
  assert.equal(institutionMetadataOverride("Unknown University"), null);
});

test("system boards and an online college carry metadata for the strict audit", () => {
  assert.deepEqual(institutionMetadataOverride("Calbright College"), { state: "CA", control: "public", level: "2-year" });
  for (const [name, state] of [
    ["Oklahoma State University System", "OK"],
    ["Southern University System Vacancies", "LA"],
    ["Seattle Colleges", "WA"],
    ["Spokane Colleges", "WA"],
  ]) {
    assert.deepEqual(institutionMetadataOverride(name), { state, control: "public", level: "4-year" }, name);
  }
});
