import assert from "node:assert/strict";
import test from "node:test";

import {
  extractPaycomHostConfig,
  extractPaycomPosting,
  fetchPaycomPosting,
  parsePaycomJobUrl,
  paycomHtmlToText,
} from "../lib/paycom-description.js";

const JOB_URL = "https://www.paycomonline.net/v4/ats/web.php/portal/D735C44B01F6404D0C91B262228D396A/jobs/427011";

test("recognizes public Paycom job URLs", () => {
  assert.deepEqual(parsePaycomJobUrl(JOB_URL), {
    jobId: "427011",
    portalId: "D735C44B01F6404D0C91B262228D396A",
    referrer: JOB_URL,
  });
  assert.equal(parsePaycomJobUrl("http://www.paycomonline.net/v4/ats/web.php/portal/D735C44B01F6404D0C91B262228D396A/jobs/1"), null);
  assert.equal(parsePaycomJobUrl("https://example.edu/portal/D735C44B01F6404D0C91B262228D396A/jobs/1"), null);
  assert.equal(parsePaycomJobUrl("https://www.paycomonline.net/v4/ats/web.php/portal/not-a-portal/jobs/1"), null);
});

test("extracts balanced Paycom host config with nested JSON strings", () => {
  const config = extractPaycomHostConfig(`
    <script>var configsFromHost = {"sessionJWT":"abc.def","libConfig":"{\\"nested\\":{\\"ok\\":true},\\"atsPortalMantleServiceUrl\\":\\"https://portal-applicant-tracking.us-cent.paycomonline.net/\\"}"};</script>
  `);
  assert.equal(config.sessionJWT, "abc.def");
  assert.match(config.libConfig, /"nested":\{"ok":true\}/);
  assert.equal(extractPaycomHostConfig("<html>No configuration</html>"), null);
});

test("converts Paycom HTML and applies the minimum description length", () => {
  assert.equal(paycomHtmlToText("<p>Teaching &amp; research</p><ul><li>Service</li></ul>"), "Teaching & research Service");
  assert.deepEqual(
    extractPaycomPosting({ jobPosting: { description: "<p>Detailed faculty description</p>" } }, { minLen: 10 }),
    { desc: "Detailed faculty description", datePosted: "", validThrough: "" },
  );
  assert.equal(extractPaycomPosting({ jobPosting: { description: "short" } }).desc, "");
});

test("fetches a Paycom posting through its public detail API", async () => {
  const calls = [];
  const result = await fetchPaycomPosting(JOB_URL, {
    minLen: 10,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (calls.length === 1) {
        return {
          ok: true,
          async text() {
            const libConfig = JSON.stringify({
              atsPortalMantleServiceUrl: "https://portal-applicant-tracking.us-cent.paycomonline.net/",
            });
            return `<script>var configsFromHost = ${JSON.stringify({ sessionJWT: "jwt-value", libConfig })};</script>`;
          },
        };
      }
      return {
        ok: true,
        async json() { return { jobPosting: { description: "<p>Complete faculty posting body</p>" } }; },
      };
    },
  });

  assert.equal(result.desc, "Complete faculty posting body");
  assert.equal(calls[1].url, "https://portal-applicant-tracking.us-cent.paycomonline.net/api/ats/job-postings/427011");
  assert.equal(calls[1].options.headers.authorization, "jwt-value");
  assert.equal(calls[1].options.headers["portal-host-referrer"], JOB_URL);
});

test("rejects untrusted service hosts and failed responses", async () => {
  await assert.rejects(
    fetchPaycomPosting(JOB_URL, {
      fetchImpl: async () => ({
        ok: true,
        async text() {
          return `<script>var configsFromHost = ${JSON.stringify({
            sessionJWT: "secret",
            libConfig: JSON.stringify({ atsPortalMantleServiceUrl: "https://attacker.example/api/" }),
          })};</script>`;
        },
      }),
    }),
    /omitted its public API configuration/,
  );
});
