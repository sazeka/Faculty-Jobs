import assert from "node:assert/strict";
import test from "node:test";

import {
  adpHtmlToText,
  extractAdpPosting,
  fetchAdpPosting,
  parseAdpJobUrl,
} from "../lib/adp-description.js";

const JOB_URL = "https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=997c6fde-f713-4be9-b6cf-f4bdbc02cbbb&ccId=19000101_000001&jobId=9200129779508_1&lang=en_US&source=CC2";
const ENDPOINT = "https://workforcenow.adp.com/mascsr/default/careercenter/public/events/staffing/v1/job-requisitions/9200129779508_1?cid=997c6fde-f713-4be9-b6cf-f4bdbc02cbbb&ccId=19000101_000001&lang=en_US&locale=en_US";

test("maps ADP Workforce Now URLs to the public requisition endpoint", () => {
  assert.deepEqual(parseAdpJobUrl(JOB_URL), {
    cid: "997c6fde-f713-4be9-b6cf-f4bdbc02cbbb",
    ccId: "19000101_000001",
    jobId: "9200129779508_1",
    lang: "en_US",
    endpoint: ENDPOINT,
  });
  assert.ok(parseAdpJobUrl(JOB_URL.replace("workforcenow.adp.com", "workforcenow.cloud.adp.com")));
  assert.equal(parseAdpJobUrl("https://example.edu/jobs/1"), null);
  assert.equal(parseAdpJobUrl("https://workforcenow.adp.com/jobs?cid=bad&jobId=1"), null);
});

test("extracts ADP description HTML and posting date", () => {
  assert.equal(adpHtmlToText("<link href='x'><p>Teaching &amp; research</p><ul><li>Service</li></ul>"), "Teaching & research Service");
  assert.deepEqual(
    extractAdpPosting({ requisitionDescription: "<p>Complete faculty description</p>", postDate: "2026-08-20T10:00:00Z" }, { minLen: 10 }),
    { desc: "Complete faculty description", datePosted: "2026-08-20T10:00:00Z", validThrough: "" },
  );
  assert.equal(extractAdpPosting({ requisitionDescription: "short" }).desc, "");
});

test("fetches an ADP posting through the public requisition endpoint", async () => {
  let call;
  const result = await fetchAdpPosting(JOB_URL, {
    minLen: 10,
    fetchImpl: async (url, options) => {
      call = { url, options };
      return {
        ok: true,
        async json() {
          return { requisitionDescription: "<p>Detailed faculty posting</p>", postDate: "2026-08-20" };
        },
      };
    },
  });
  assert.equal(call.url, ENDPOINT);
  assert.equal(call.options.headers.accept, "application/json");
  assert.equal(result.desc, "Detailed faculty posting");
  assert.equal(result.datePosted, "2026-08-20");
});

test("rejects unsupported URLs and failed ADP responses", async () => {
  await assert.rejects(fetchAdpPosting("https://example.edu/jobs/1"), /Unsupported ADP/);
  await assert.rejects(
    fetchAdpPosting(JOB_URL, { fetchImpl: async () => ({ ok: false, status: 404 }) }),
    /HTTP 404/,
  );
});
