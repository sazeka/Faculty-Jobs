import assert from "node:assert/strict";
import test from "node:test";

import { extractRequisitionId, computeCanonicalGroupId, attachCanonicalIds } from "../lib/canonical-id.js";

// Issue #135: canonicalGroupId previously hashed only
// `title|college|department|state`, so genuinely distinct requisitions that
// happened to share those four fields collapsed into one canonical group and
// the frontend rendered only one card for several unrelated openings. Each
// test below is one of the issue's confirmed real-world examples.

test("extractRequisitionId reads the TAMU JobId query parameter", () => {
  const a = extractRequisitionId("https://faculty.tamu.edu/JobDetail.aspx?PositionId=179558&JobId=183029");
  const b = extractRequisitionId("https://faculty.tamu.edu/JobDetail.aspx?PositionId=185494&JobId=188488");
  assert.notEqual(a, null);
  assert.notEqual(b, null);
  assert.notEqual(a, b);
});

test("extractRequisitionId reads a Workday requisition suffix, ignoring a reprint '-N' suffix", () => {
  const a = extractRequisitionId("https://example.wd1.myworkdayjobs.com/External/job/Site/Adjunct-Faculty--Biology_JR0000108187");
  const b = extractRequisitionId("https://example.wd1.myworkdayjobs.com/External/job/Site/Adjunct-Faculty--Biology_JR0000108188");
  assert.notEqual(a, null);
  assert.notEqual(a, b);
  // A "-1" reprint suffix is the same requisition, not a different one.
  assert.equal(
    extractRequisitionId("https://example.wd1.myworkdayjobs.com/External/job/Site/Adjunct-Faculty--Accounting_JR101035"),
    extractRequisitionId("https://example.wd1.myworkdayjobs.com/External/job/Site/Adjunct-Faculty--Accounting_JR101035-1")
  );
});

test("extractRequisitionId reads a Workday requisition id with an underscore before the digits (UT Austin shape)", () => {
  const a = extractRequisitionId("https://utaustin.wd1.myworkdayjobs.com/UTstaff/job/AUSTIN-TX/Postdoctoral-Fellow_R_00048760-1");
  const b = extractRequisitionId("https://utaustin.wd1.myworkdayjobs.com/UTstaff/job/AUSTIN-TX/Postdoctoral-Fellow_R_00046894-1");
  assert.notEqual(a, null);
  assert.notEqual(a, b);
});

test("extractRequisitionId reads a PeopleAdmin stable posting id", () => {
  assert.notEqual(extractRequisitionId("https://jobs.geneseo.edu/postings/5637"), null);
  assert.notEqual(
    extractRequisitionId("https://jobs.geneseo.edu/postings/5637"),
    extractRequisitionId("https://jobs.geneseo.edu/postings/5638")
  );
});

test("extractRequisitionId reads a PageUp numeric job id (SUNY Downstate shape)", () => {
  const a = extractRequisitionId("https://careers.pageuppeople.com/977/cw/en-us/job/497215");
  const b = extractRequisitionId("https://careers.pageuppeople.com/977/cw/en-us/job/497216");
  assert.notEqual(a, null);
  assert.notEqual(a, b);
});

test("extractRequisitionId reads a trailing UUID (PageUp/vendor career-site shape, Michigan State)", () => {
  const a = extractRequisitionId(
    "https://careers.msu.edu/jobs/associate-full-professor-tenure-system-flint-michigan-united-states-895e1923-fc94-4c55-ab79-49f75277e805"
  );
  const b = extractRequisitionId(
    "https://careers.msu.edu/jobs/associate-full-professor-tenure-system-flint-michigan-united-states-bfa979ef-b744-4e70-8f66-2fe3a4998bb2"
  );
  assert.notEqual(a, null);
  assert.notEqual(a, b);
});

test("extractRequisitionId returns null when no known stable-id shape is present", () => {
  assert.equal(extractRequisitionId("https://example.edu/careers"), null);
  assert.equal(extractRequisitionId(""), null);
  assert.equal(extractRequisitionId(null), null);
});

test("computeCanonicalGroupId keeps Texas A&M's three same-titled, different-requisition searches separate (issue #135)", () => {
  const base = {
    titleClean: "Academic Professional Track (Non-Tenure): Clinical Assistant Professor or Clinical Associate Professor",
    college: "Texas A&M University",
    department: null,
    state: "TX",
  };
  const ids = new Set([
    computeCanonicalGroupId({ ...base, url: "https://faculty.tamu.edu/JobDetail.aspx?PositionId=179558&JobId=183029" }),
    computeCanonicalGroupId({ ...base, url: "https://faculty.tamu.edu/JobDetail.aspx?PositionId=185494&JobId=188488" }),
    computeCanonicalGroupId({ ...base, url: "https://faculty.tamu.edu/JobDetail.aspx?PositionId=180866&JobId=184188" }),
  ]);
  assert.equal(ids.size, 3);
});

test("computeCanonicalGroupId keeps Michigan State's three identically-titled Flint searches separate (issue #135)", () => {
  const base = {
    titleClean: "Associate/Full Professor of Human Medicine - Tenure System",
    college: "Michigan State University",
    department: "College of Human Medicine",
    state: "MI",
    location: "East Lansing, MI",
  };
  const ids = new Set([
    computeCanonicalGroupId({
      ...base,
      url: "https://careers.msu.edu/jobs/associate-full-professor-tenure-system-flint-michigan-united-states-895e1923-fc94-4c55-ab79-49f75277e805",
    }),
    computeCanonicalGroupId({
      ...base,
      url: "https://careers.msu.edu/jobs/associate-full-professor-tenure-system-flint-michigan-united-states-bfa979ef-b744-4e70-8f66-2fe3a4998bb2",
    }),
    computeCanonicalGroupId({
      ...base,
      url: "https://careers.msu.edu/jobs/associate-full-professor-tenure-system-flint-michigan-united-states-86556cc5-396d-471e-b100-1e0d63e7d387",
    }),
  ]);
  assert.equal(ids.size, 3);
});

test("computeCanonicalGroupId keeps SUNY Downstate's identically-titled PageUp requisitions separate (issue #135)", () => {
  const base = {
    titleClean: "Adjunct Instructor, College of Nursing",
    college: "SUNY Downstate Health Sciences University",
    department: "College of Nursing",
    state: "NY",
  };
  const ids = new Set([
    "496950",
    "496951",
    "496952",
  ].map((id) => computeCanonicalGroupId({ ...base, url: `https://careers.pageuppeople.com/977/cw/en-us/job/${id}` })));
  assert.equal(ids.size, 3);
});

test("computeCanonicalGroupId still groups two representations of the exact same posting (no requisition id, same everything)", () => {
  const a = computeCanonicalGroupId({
    titleClean: "Assistant Professor of Biology",
    college: "Example College",
    department: "Biology",
    state: "OH",
    location: "Columbus, OH",
    url: "https://example.edu/jobs/1",
  });
  const b = computeCanonicalGroupId({
    titleClean: "Assistant Professor of Biology",
    college: "Example College",
    department: "Biology",
    state: "OH",
    location: "Columbus, OH",
    url: "https://example.edu/jobs/1?utm_source=x",
  });
  assert.equal(a, b);
});

test("computeCanonicalGroupId still separates same title/college/department postings in different cities with no extractable id", () => {
  const a = computeCanonicalGroupId({
    titleClean: "Adjunct Faculty - Biology",
    college: "Ivy Tech Community College",
    department: "Biology",
    state: "IN",
    location: "Indianapolis, IN",
    url: "https://example.edu/careers/generic-search-result",
  });
  const b = computeCanonicalGroupId({
    titleClean: "Adjunct Faculty - Biology",
    college: "Ivy Tech Community College",
    department: "Biology",
    state: "IN",
    location: "Sellersburg, IN",
    url: "https://example.edu/careers/generic-search-result",
  });
  assert.notEqual(a, b);
});

test("attachCanonicalIds always recomputes IDs from current field values rather than preserving stale ones", () => {
  const [job] = attachCanonicalIds([
    { title: "Assistant Professor", college: "Example College", canonicalGroupId: "stale", canonicalJobId: "stale" },
  ]);
  assert.notEqual(job.canonicalGroupId, "stale");
  assert.notEqual(job.canonicalJobId, "stale");
});
