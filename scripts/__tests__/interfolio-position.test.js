import assert from "node:assert/strict";
import test from "node:test";
import { buildInterfolioPositionJob } from "../../server.js";

test("buildInterfolioPositionJob accepts an open official faculty record", () => {
  const job = buildInterfolioPositionJob({
    position_id: 190595,
    position_name: "Assistant, Advanced Assistant, Associate, or Full Professor of Economics",
    landing_page_url: "https://apply.interfolio.com/190595",
    landing_page_description: "<p>Open-rank (tenured or tenure-track) position.</p>",
    location: "Williamstown, Massachusetts, UNITED STATES",
    start_date: "Aug 31, 2026",
    end_date: "Nov 15, 2026",
    is_open: true,
    is_closed: false,
  }, "Williams College", "MA");

  assert.equal(job.title, "Assistant, Advanced Assistant, Associate, or Full Professor of Economics");
  assert.equal(job.url, "https://apply.interfolio.com/190595");
  assert.equal(job.description, "Open-rank (tenured or tenure-track) position.");
  assert.equal(job.datePosted, "2026-08-31");
  assert.equal(job.closeDate, "2026-11-15");
});

test("buildInterfolioPositionJob drops closed and non-faculty records", () => {
  assert.equal(buildInterfolioPositionJob({
    position_id: 1,
    position_name: "Assistant Professor",
    is_open: false,
    is_closed: true,
  }, "Example College", "MA"), null);
  assert.equal(buildInterfolioPositionJob({
    position_id: 2,
    position_name: "Human Resources Coordinator",
    is_open: true,
    is_closed: false,
  }, "Example College", "MA"), null);
});
