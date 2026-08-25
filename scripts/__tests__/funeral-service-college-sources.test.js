import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildScopedPaylocityFacultyJobs } from "../../server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, name), "utf8"));

test("Pierce Mortuary jobs require an exact sibling-college location", () => {
  const rows = [
    { title: "Full-Time Funeral Service Instructor", url: "https://example.test/mid-america", location: "MID-AMERICA" },
    { title: "Assistant Professor of Funeral Service", url: "https://example.test/gupton-jones", location: "GUPTON-JONES" },
    { title: "Academic Coordinator", url: "https://example.test/dallas", location: "DALLAS" },
    { title: "Part-Time Funeral Service Instructor", url: "https://example.test/part-time", location: "GUPTON-JONES" },
    { title: "Professor", url: "https://example.test/lookalike", location: "GUPTON-JONES CAMPUS" },
  ];

  const gupton = buildScopedPaylocityFacultyJobs(rows, "Gupton Jones College of Funeral Service", "GA", "GUPTON-JONES");
  assert.deepEqual(gupton.map((job) => job.url), ["https://example.test/gupton-jones"]);
  assert.equal(gupton[0].college, "Gupton Jones College of Funeral Service");
  assert.equal(gupton[0].location, "GUPTON-JONES");

  const midAmerica = buildScopedPaylocityFacultyJobs(rows, "Mid-America College of Funeral Service", "IN", "MID-AMERICA");
  assert.deepEqual(midAmerica.map((job) => job.url), ["https://example.test/mid-america"]);
});

test("verified funeral-service colleges have scoped production sources", () => {
  const master = readJson("data/institutions-master.json").institutions;
  const report = readJson("generated/funeral-service-college-pass-report.json");
  const byName = new Map(master.map((row) => [row.name, row]));

  assert.equal(report.requestedMilestoneReviewed, 4);
  assert.equal(report.accepted, 2);
  assert.equal(report.unresolvedCount, 3);
  for (const source of report.acceptedSources) {
    const institution = byName.get(source.name);
    assert.equal(institution?.coverage_status, "covered", source.name);
    assert.equal(institution?.career_url, source.career_url, source.name);
    assert.equal(institution?.platform_type, source.platform_type, source.name);
  }
});
