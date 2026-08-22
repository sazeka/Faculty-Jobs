import assert from "node:assert/strict";
import test from "node:test";

import {
  DESCRIPTION_FETCH_VERSION,
  descriptionAttemptCount,
  isUnsupportedDescriptionUrl,
  needsDescriptionFetch,
  prioritizeDescriptionCandidates,
} from "../lib/description-backfill.js";

const NOW = Date.parse("2026-08-20T00:00:00.000Z");

test("fetches new descriptions and retries one stale empty result", () => {
  assert.equal(needsDescriptionFetch({ url: "https://example.edu/1" }, NOW), true);
  assert.equal(needsDescriptionFetch({ url: "https://example.edu/1", description: "Already filled" }, NOW), false);
  assert.equal(needsDescriptionFetch({ url: "javascript:void(0)" }, NOW), false);
  assert.equal(needsDescriptionFetch({
    url: "https://example.edu/1",
    descriptionFetchedAt: "2026-08-01T00:00:00.000Z",
  }, NOW), true);
  assert.equal(needsDescriptionFetch({
    url: "https://example.edu/1",
    descriptionFetchedAt: "2026-08-19T00:00:00.000Z",
  }, NOW), false);
  assert.equal(needsDescriptionFetch({
    url: "https://example.edu/1",
    descriptionFetchedAt: "2026-08-01T00:00:00.000Z",
    descriptionFetchAttempts: 2,
  }, NOW), false);
  assert.equal(descriptionAttemptCount({ descriptionFetchedAt: "2026-08-01" }), 1);
});

test("skips virtual OneUSG search fragments that cannot resolve to public detail pages", () => {
  const url = "https://careers.hprod.onehcm.usg.edu/psc/careers/CAREERS/HRMS/c/HRS_HRAM_FL.HRS_CG_SEARCH_FL.GBL?Page=HRS_APP_SCHJOB_FL#jobId=300794";
  assert.equal(isUnsupportedDescriptionUrl(url), true);
  assert.equal(needsDescriptionFetch({ url }, NOW), false);
  assert.equal(isUnsupportedDescriptionUrl("https://example.edu/jobs/300794"), false);
});

test("skips InterviewExchange pages blocked by the platform-wide Hirezon WAF", () => {
  const tenantUrl = "https://fredonia.interviewexchange.com/jobofferdetails.jsp?JOBID=188165";
  const sharedUrl = "https://www.interviewexchange.com/jobofferdetails.jsp?JOBID=180452";
  assert.equal(isUnsupportedDescriptionUrl(tenantUrl), true);
  assert.equal(isUnsupportedDescriptionUrl(sharedUrl), true);
  assert.equal(needsDescriptionFetch({ url: tenantUrl }, NOW), false);
  assert.equal(isUnsupportedDescriptionUrl("https://interviewexchange.example.edu/jobs/1"), false);
});

test("immediately retries Workday results captured by the pre-fix fetcher once", () => {
  const oldResult = {
    url: "https://school.wd1.myworkdayjobs.com/jobs/job/example_R123",
    descriptionFetchedAt: "2026-08-19T00:00:00.000Z",
    descriptionFetchAttempts: 2,
    descriptionFetchStatus: "empty",
  };
  assert.equal(needsDescriptionFetch(oldResult, NOW), true);
  assert.equal(needsDescriptionFetch({
    ...oldResult,
    descriptionFetchVersion: DESCRIPTION_FETCH_VERSION,
  }, NOW), false);
  assert.equal(needsDescriptionFetch({
    ...oldResult,
    descriptionFetchVersion: 3,
  }, NOW), false);
});

test("immediately retries Paycom results captured before the direct API fetcher", () => {
  const oldResult = {
    url: "https://www.paycomonline.net/v4/ats/web.php/portal/D735C44B01F6404D0C91B262228D396A/jobs/427011",
    descriptionFetchedAt: "2026-08-19T00:00:00.000Z",
    descriptionFetchAttempts: 2,
    descriptionFetchStatus: "empty",
    descriptionFetchVersion: DESCRIPTION_FETCH_VERSION - 1,
  };
  assert.equal(needsDescriptionFetch(oldResult, NOW), true);
  assert.equal(needsDescriptionFetch({
    ...oldResult,
    descriptionFetchVersion: DESCRIPTION_FETCH_VERSION,
  }, NOW), false);
});

test("prioritizes unknown tenure and then newer postings", () => {
  const jobs = [
    { canonicalJobId: "known", url: "https://example.edu/known", tenureTrack: false, datePosted: "2026-08-20" },
    { canonicalJobId: "old", url: "https://example.edu/old", datePosted: "2026-08-01" },
    { canonicalJobId: "new", url: "https://example.edu/new", datePosted: "2026-08-19" },
  ];
  assert.deepEqual(
    prioritizeDescriptionCandidates(jobs, NOW).map(job => job.canonicalJobId),
    ["new", "old", "known"]
  );
});
