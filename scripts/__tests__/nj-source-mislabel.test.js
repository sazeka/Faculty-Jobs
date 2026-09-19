import test from "node:test";
import assert from "node:assert/strict";
import { toNjJob, linkPlausiblyMatchesHeading } from "../../server.js";

// Regression coverage for issue #165: scrapeFacultyHeadingPageAs and
// scrapeFacultyTablePageAs reuse toNjJob() (originally written only for the
// NJ scraping pipeline) as a shared job-record builder for every state that
// uses the "faculty-headings"/"faculty-table" scraper types. Before the fix,
// toNjJob() unconditionally hardcoded `source: "NJ"` and bound the caller's
// real state code to its `category` parameter instead -- so a Massachusetts,
// North Carolina, Virginia, Texas, or Mississippi institution's job got
// `source: "NJ"` (always wrong except for actual NJ campuses) while the true
// state landed in `category`, which the frontend's inferState() never
// consults (it only reads job.state / job.source).

test("toNjJob defaults to the NJ pipeline's original behavior when no source is passed", () => {
  const job = toNjJob("Adjunct Instructor", "https://example.com/job/1", "Some NJ College");
  assert.equal(job.source, "NJ");
  assert.equal(job.category, "Faculty");
});

test("toNjJob uses the explicit source argument instead of hardcoding NJ (issue #165)", () => {
  const maJob = toNjJob("Visiting Assistant Professor", "https://www.nesl.edu/careers/1", "New England Law-Boston", "Faculty", "MA");
  assert.equal(maJob.source, "MA");
  assert.equal(maJob.category, "Faculty", "category must stay a real job category, not the state");

  const txJob = toNjJob("Accounting Faculty", "https://paulquinn.edu/opportunities", "Paul Quinn College", "Faculty", "TX");
  assert.equal(txJob.source, "TX");
  assert.equal(txJob.category, "Faculty");

  const msJob = toNjJob("Adjunct Faculty - Biology", "https://rustcollege.edu/job-listings/1", "Rust College", "Faculty", "MS");
  assert.equal(msJob.source, "MS");
  assert.equal(msJob.category, "Faculty");

  const ncJob = toNjJob("Adjunct Nursing Clinical Faculty Position", "https://ncwu.edu/careers/1", "North Carolina Wesleyan University", "Faculty", "NC");
  assert.equal(ncJob.source, "NC");

  const vaJob = toNjJob("Open-Rank Professor of Biology", "https://svu.edu/careers/1", "Southern Virginia University", "Faculty", "VA");
  assert.equal(vaJob.source, "VA");
});

// Regression coverage for issue #162: on a faculty-heading page listing
// several postings close together, a link found only via "any link in the
// heading's parent element" (not wrapping/inside the heading itself) can
// belong to a completely different, adjacent posting. Confirmed live: New
// England Law-Boston's "Visiting Assistant Professor of Academic Excellence,
// Bar Examination Preparation Program" heading picked up a neighboring
// "Digital-Marketing-Manager-August-2026-1.pdf" link this way.
test("linkPlausiblyMatchesHeading rejects an unrelated adjacent-posting link (issue #162)", () => {
  assert.equal(
    linkPlausiblyMatchesHeading(
      "Visiting Assistant Professor of Academic Excellence, Bar Examination Preparation Program",
      "https://www.nesl.edu/wp-content/uploads/2026/08/Digital-Marketing-Manager-August-2026-1.pdf"
    ),
    false
  );
});

test("linkPlausiblyMatchesHeading accepts a link whose filename overlaps the heading", () => {
  assert.equal(
    linkPlausiblyMatchesHeading(
      "Visiting Assistant Professor of Academic Excellence, Bar Examination Preparation Program",
      "https://www.nesl.edu/wp-content/uploads/2026/06/New-England-Law-Visiting-Asst-Prof-Bar-Prep.pdf"
    ),
    true
  );
});

test("linkPlausiblyMatchesHeading trusts a link with no descriptive filename (e.g. a bare ATS id)", () => {
  assert.equal(
    linkPlausiblyMatchesHeading("Adjunct Faculty - Biology", "https://example.wd1.myworkdayjobs.com/Jobs/job/Campus/R12345"),
    true
  );
  assert.equal(linkPlausiblyMatchesHeading("Adjunct Faculty - Biology", "not a url"), true);
});
