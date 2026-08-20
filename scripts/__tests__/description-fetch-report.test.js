import assert from "node:assert/strict";
import test from "node:test";

import { createDescriptionFetchReport } from "../lib/description-fetch-report.js";

test("summarizes description outcomes by platform and host", () => {
  const report = createDescriptionFetchReport();
  report.record("https://school.wd1.myworkdayjobs.com/jobs/1", "filled");
  report.record("https://school.wd1.myworkdayjobs.com/jobs/2", "empty");
  report.record("https://other.wd5.myworkdayjobs.com/jobs/3", "errors");
  report.record("https://college.interviewexchange.com/job/4", "filled");

  const summary = report.summarize();
  assert.deepEqual(summary.byPlatform[0], {
    platform: "workday",
    attempted: 3,
    filled: 1,
    empty: 1,
    errors: 1,
    fillRatePct: 33.3,
    failureRatePct: 66.7,
  });
  assert.deepEqual(summary.byHost[0], {
    platform: "workday",
    host: "school.wd1.myworkdayjobs.com",
    attempted: 2,
    filled: 1,
    empty: 1,
    errors: 0,
    fillRatePct: 50,
    failureRatePct: 50,
  });
});
