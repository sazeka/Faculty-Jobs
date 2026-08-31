import assert from "node:assert/strict";
import test from "node:test";
import { peopleSoftJobDetailUrl } from "../lib/peoplesoft-job-url.js";

test("builds a stable PeopleSoft posting URL and preserves SiteId", () => {
  assert.equal(
    peopleSoftJobDetailUrl(
      "https://jobs.example.edu/psc/app/EMPLOYEE/HRMS/c/HRS_HRAM_FL.HRS_CG_SEARCH_FL.GBL?Page=HRS_APP_SCHJOB_FL&SiteId=21#15769",
      "15769",
    ),
    "https://jobs.example.edu/psc/app/EMPLOYEE/HRMS/c/HRS_HRAM_FL.HRS_CG_SEARCH_FL.GBL?Page=HRS_APP_JBPST_FL&Action=U&FOCUS=Applicant&SiteId=21&JobOpeningId=15769&PostingSeq=1",
  );
});

test("defaults PeopleSoft SiteId to one and rejects missing IDs", () => {
  assert.match(peopleSoftJobDetailUrl("https://jobs.example.edu/search?Page=HRS_APP_SCHJOB_FL", "63363"), /SiteId=1&JobOpeningId=63363/);
  assert.equal(peopleSoftJobDetailUrl("https://jobs.example.edu/search", ""), null);
});
