import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildScopedHospitalFacultyJobs } from "../../server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, name), "utf8"));

test("shared hospital rows require an exact school scope", () => {
  const rows = [
    { title: "Nursing Education Instructor - Full Time", url: "https://example.test/college", scopeText: "COLLEGE OF NURSING", location: "Utica, NY" },
    { title: "Nurse Educator - ICU", url: "https://example.test/hospital", scopeText: "WYNN HOSPITAL", location: "Utica, NY" },
    { title: "Clinical Instructor - Part Time", url: "https://example.test/part-time", scopeText: "COLLEGE OF NURSING", location: "Utica, NY" },
  ];

  const jobs = buildScopedHospitalFacultyJobs(rows, "Saint Elizabeth College of Nursing", "NY", "COLLEGE OF NURSING");
  assert.deepEqual(jobs.map((job) => job.url), ["https://example.test/college"]);
  assert.equal(jobs[0].college, "Saint Elizabeth College of Nursing");
});

test("the three verified nursing schools have scoped production sources", () => {
  const master = readJson("data/institutions-master.json").institutions;
  const report = readJson("generated/hospital-nursing-school-pass-report.json");
  const byName = new Map(master.map((row) => [row.name, row]));

  assert.equal(report.accepted, 3);
  for (const source of report.acceptedSources) {
    const institution = byName.get(source.name);
    assert.equal(institution?.coverage_status, "covered", source.name);
    assert.equal(institution?.career_url, source.career_url, source.name);
    assert.equal(institution?.platform_type, source.platform_type, source.name);
  }
});
