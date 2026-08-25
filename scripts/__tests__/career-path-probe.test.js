import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalizeDiscoveredCareerUrl, compareDiscoveryPriority, excludePreviouslyReported, isRejectedCareerPage, shouldReplaceDiscoveredPlatform } from "../lib/career-path-probe.js";

test("career path probing rejects fabricated faculty/jobs and soft-404 pages", () => {
  assert.equal(isRejectedCareerPage("https://example.edu/faculty/jobs"), true);
  assert.equal(
    isRejectedCareerPage("https://example.edu/404-not-found?request=/faculty/jobs"),
    true
  );
  assert.equal(
    isRejectedCareerPage("https://example.edu/careers", "<title>404 - Page Not Found</title>"),
    true
  );
});

test("career path probing accepts a normal employment page", () => {
  assert.equal(
    isRejectedCareerPage("https://example.edu/human-resources/employment", "<title>Employment Opportunities</title>"),
    false
  );
});

test("career path probing rejects student-facing career and library resources", () => {
  assert.equal(
    isRejectedCareerPage("https://example.edu/career-readiness/experiential-learning/faculty-led-travel/"),
    true
  );
  assert.equal(
    isRejectedCareerPage("https://example.edu/distance-education-library-services/employment-resources/"),
    true
  );
  assert.equal(isRejectedCareerPage("https://example.edu/academics/academic-programs/careers-electric-academy/"), true);
  assert.equal(isRejectedCareerPage("https://example.edu/careers/career-exploration/faculty-services/"), true);
  assert.equal(isRejectedCareerPage("https://example.edu/about/news/student-employment-program/"), true);
  assert.equal(isRejectedCareerPage("https://example.edu/student-employment/"), true);
  assert.equal(isRejectedCareerPage("https://example.edu/job/administrative-coordinator/"), true);
  assert.equal(isRejectedCareerPage("https://example.edu/careers", "<title>Career Services</title>"), true);
});

test("career path probing rejects student career pages that previously scored as hiring sources", () => {
  const falsePositives = [
    "https://lasierra.edu/services/student-academic-support/career-services",
    "https://www.lamar.edu/career-and-testing-services",
    "https://www.midland.edu/services-resources/career-transfer-center/index.php",
    "https://www2.naz.edu/career-design-office",
    "https://www.park.edu/current-students/career",
    "https://www.regis.edu/academics/student-success/career-professional-development",
    "https://www.wccnet.edu/succeed/center-for-career-success",
    "https://www.widener.edu/academics/academic-resources-success/academic-career-support/career-design-development",
    "https://www.midlandstech.edu/admissions/academic-and-career-advising",
    "https://www.rcsj.edu/degrees-programs/academic-divisions/career-and-technical-education-division/",
    "https://www.oiah.edu/student-services/career-placement/",
  ];
  for (const url of falsePositives) assert.equal(isRejectedCareerPage(url), true, url);
});

test("career path probing rejects individual job details and faculty directories as source pages", () => {
  const nonBoards = [
    "https://www.schooljobs.com/careers/northweststate/jobs/5444125/industrial-technology-faculty",
    "https://osu.wd1.myworkdayjobs.com/en-US/OSUCareers/job/Business-Finance-Lecturer_R154017",
    "https://unm.csod.com/ux/ats/careersite/18/home/requisition/37328?c=unm",
    "https://recruiting.paylocity.com/recruiting/jobs/Details/3272529/example/faculty-position",
    "https://careers.insidehighered.com/job/3523006/academic-advisor/",
    "https://lifewest.edu/faculty",
  ];
  for (const url of nonBoards) assert.equal(isRejectedCareerPage(url), true, url);
});

test("career discovery prioritizes unattempted and least-recently attempted institutions", () => {
  const rows = [
    { name: "Recent", discovery_attempts: 1, last_discovery_attempt_at: "2026-08-20" },
    { name: "Unattempted", discovery_attempts: 0 },
    { name: "Older", discovery_attempts: 1, last_discovery_attempt_at: "2026-08-01" },
  ];
  rows.sort(compareDiscoveryPriority);
  assert.deepEqual(rows.map((row) => row.name), ["Unattempted", "Older", "Recent"]);
});

test("career discovery can skip every institution from the previous batch report", () => {
  const rows = [{ name: "First College" }, { name: "Second University" }, { name: "Third Institute" }];
  const priorResults = [{ name: " first   college " }, { name: "SECOND UNIVERSITY" }];
  assert.deepEqual(excludePreviouslyReported(rows, priorResults), [{ name: "Third Institute" }]);
});

test("career discovery replaces placeholder generic platforms with validated ATS types", () => {
  assert.equal(shouldReplaceDiscoveredPlatform("generic"), true);
  assert.equal(shouldReplaceDiscoveredPlatform(""), true);
  assert.equal(shouldReplaceDiscoveredPlatform("workday"), false);
  assert.equal(shouldReplaceDiscoveredPlatform("workday", true), true);
});

test("career discovery canonicalizes redirect, job-detail, and session URLs", () => {
  assert.equal(
    canonicalizeDiscoveredCareerUrl("https://www.schooljobs.com/careers/example/jobs/1234/faculty-role?pagetype=promotionalJobs"),
    "https://www.schooljobs.com/careers/example",
  );
  assert.equal(
    canonicalizeDiscoveredCareerUrl("https://outlook.office.com.invalid/"),
    "https://outlook.office.com.invalid/",
  );
  assert.equal(
    canonicalizeDiscoveredCareerUrl("https://nam11.safelinks.protection.outlook.com/?url=https%3A%2F%2Fwww.schooljobs.com%2Fcareers%2Fcollege%2Fjobs%2F123%2Frole&data=x"),
    "https://www.schooljobs.com/careers/college",
  );
  assert.equal(
    canonicalizeDiscoveredCareerUrl("https://college.interviewexchange.com/static/clients/123/index.jsp;jsessionid=ABC123"),
    "https://college.interviewexchange.com/static/clients/123/index.jsp",
  );
});
