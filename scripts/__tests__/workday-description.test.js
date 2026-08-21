import test from "node:test";
import assert from "node:assert/strict";
import {
  buildWorkdayCxsUrl,
  extractWorkdayPosting,
  fetchWorkdayPosting,
  workdayHtmlToText,
} from "../lib/workday-description.js";

test("maps standard Workday job URLs to the public CXS detail endpoint", () => {
  assert.equal(
    buildWorkdayCxsUrl("https://osu.wd1.myworkdayjobs.com/OSUCareers/job/Columbus-Campus/Professor_R156872-1"),
    "https://osu.wd1.myworkdayjobs.com/wday/cxs/osu/OSUCareers/job/Columbus-Campus/Professor_R156872-1",
  );
  assert.equal(
    buildWorkdayCxsUrl("https://usnh.wd5.myworkdayjobs.com/Careers/job/Main-Campus/Professor_JR4784?source=Indeed"),
    "https://usnh.wd5.myworkdayjobs.com/wday/cxs/usnh/Careers/job/Main-Campus/Professor_JR4784",
  );
  assert.equal(
    buildWorkdayCxsUrl("https://cscc.wd1.myworkdayjobs.com/CSCC_ext/job/Adjunct---Accounting_JR001308"),
    "https://cscc.wd1.myworkdayjobs.com/wday/cxs/cscc/CSCC_ext/job/Adjunct---Accounting_JR001308",
  );
  assert.equal(
    buildWorkdayCxsUrl("https://aims.wd1.myworkdayjobs.com/Jobs/job/Greeley-CO/Professor_R1724"),
    "https://aims.wd1.myworkdayjobs.com/wday/cxs/aims/Jobs/job/Greeley-CO/Professor_R1724",
  );
});

test("handles locale prefixes and an extra jobs path segment", () => {
  assert.equal(
    buildWorkdayCxsUrl("https://theclaremontcolleges.wd1.myworkdayjobs.com/en-US/KGI_Careers/job/Building-535/Professor_REQ-4744"),
    "https://theclaremontcolleges.wd1.myworkdayjobs.com/wday/cxs/theclaremontcolleges/KGI_Careers/job/Building-535/Professor_REQ-4744",
  );
  assert.equal(
    buildWorkdayCxsUrl("https://barryu.wd5.myworkdayjobs.com/BarryU/jobs/job/Main-Campus/Professor_R0007409"),
    "https://barryu.wd5.myworkdayjobs.com/wday/cxs/barryu/BarryU/job/Main-Campus/Professor_R0007409",
  );
});

test("handles myworkdaysite recruiting URLs and keeps the final duplicated job suffix", () => {
  assert.equal(
    buildWorkdayCxsUrl("https://wd501.myworkdaysite.com/recruiting/ensigncollege/EnsignCollege/job/Ensign-College/Professor_R0026845"),
    "https://wd501.myworkdaysite.com/wday/cxs/ensigncollege/EnsignCollege/job/Ensign-College/Professor_R0026845",
  );
  assert.equal(
    buildWorkdayCxsUrl("https://wd5.myworkdaysite.com/recruiting/coloradomtn/ColoradoMountainCollege/job/Old/Old_JR1/job/Breckenridge-CO/Professor_JR2"),
    "https://wd5.myworkdaysite.com/wday/cxs/coloradomtn/ColoradoMountainCollege/job/Breckenridge-CO/Professor_JR2",
  );
});

test("converts Workday HTML and extracts posting-window dates", () => {
  const result = extractWorkdayPosting({
    jobPostingInfo: {
      jobDescription: "<p>Tenure-track &amp; faculty position.</p><script>ignore()</script><p>Apply now.</p>",
      startDate: "2026-08-14",
      endDate: "2026-09-25",
    },
  }, { minLen: 20 });
  assert.deepEqual(result, {
    desc: "Tenure-track & faculty position. Apply now.",
    datePosted: "2026-08-14",
    validThrough: "2026-09-25",
  });
  assert.equal(workdayHtmlToText("Dean&#39;s&nbsp;Office"), "Dean's Office");
});

test("fetches a Workday posting through the mapped endpoint", async () => {
  let requested = "";
  const result = await fetchWorkdayPosting(
    "https://umiami.wd1.myworkdayjobs.com/UMFaculty/job/Miami-FL/Professor_R1001",
    {
      minLen: 10,
      fetchImpl: async (url) => {
        requested = url;
        return {
          ok: true,
          async json() {
            return { jobPostingInfo: { jobDescription: "<p>Detailed faculty description</p>" } };
          },
        };
      },
    },
  );
  assert.equal(requested, "https://umiami.wd1.myworkdayjobs.com/wday/cxs/umiami/UMFaculty/job/Miami-FL/Professor_R1001");
  assert.equal(result.desc, "Detailed faculty description");
});

test("rejects non-Workday and failed detail responses", async () => {
  assert.equal(buildWorkdayCxsUrl("https://example.edu/jobs/1"), null);
  await assert.rejects(
    fetchWorkdayPosting("https://osu.wd1.myworkdayjobs.com/OSUCareers/job/Place/Professor_R1", {
      fetchImpl: async () => ({ ok: false, status: 404 }),
    }),
    /HTTP 404/,
  );
});
