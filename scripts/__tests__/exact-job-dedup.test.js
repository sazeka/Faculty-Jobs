import assert from "node:assert/strict";
import test from "node:test";
import { dedupeExactListings } from "../lib/exact-job-dedup.js";

test("exact listing dedupe keeps the richest copy and fills missing fields", () => {
  const duplicate = {
    college: "Example University",
    title: "Assistant Professor",
    url: "https://example.edu/jobs/42",
  };
  const result = dedupeExactListings([
    { ...duplicate, firstSeen: "2026-09-10", discipline: "Engineering" },
    { ...duplicate, firstSeen: "2026-09-12", department: "Mechanical Engineering", description: "A detailed posting.", tenureTrack: true },
  ]);

  assert.equal(result.removed, 1);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].department, "Mechanical Engineering");
  assert.equal(result.jobs[0].discipline, "Engineering");
  assert.equal(result.jobs[0].firstSeen, "2026-09-10");
  assert.equal(result.jobs[0].tenureTrack, true);
});

test("same URL at different institutions remains distinct", () => {
  const shared = { title: "Professor", url: "https://system.example/jobs/42" };
  const result = dedupeExactListings([
    { ...shared, college: "North Campus" },
    { ...shared, college: "South Campus" },
  ]);

  assert.equal(result.removed, 0);
  assert.equal(result.jobs.length, 2);
});
