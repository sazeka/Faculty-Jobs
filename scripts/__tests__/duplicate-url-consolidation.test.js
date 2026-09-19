import assert from "node:assert/strict";
import test from "node:test";
import { consolidateSystemUmbrellaDuplicates, consolidateWorkdayRequisitionDuplicates } from "../lib/duplicate-url-consolidation.js";
import { isSystemUmbrellaCollege } from "../lib/system-umbrella-institutions.js";

function job(overrides) {
  return {
    title: "Assistant Professor",
    url: "https://example.edu/postings/1",
    department: null,
    state: "XX",
    ...overrides,
  };
}

test("recognizes verified system/umbrella catch-all labels", () => {
  assert.equal(isSystemUmbrellaCollege("University of Hawaii System"), true);
  assert.equal(isSystemUmbrellaCollege("UW System Comprehensives"), true);
  assert.equal(isSystemUmbrellaCollege("University of Alaska System"), true);
  assert.equal(isSystemUmbrellaCollege("Indiana University"), true);
  assert.equal(isSystemUmbrellaCollege("University of Connecticut"), true);
});

test("does not treat real, specific campuses as umbrella labels", () => {
  assert.equal(isSystemUmbrellaCollege("University of Hawaii-West Oahu"), false);
  assert.equal(isSystemUmbrellaCollege("Indiana University-Bloomington"), false);
  assert.equal(isSystemUmbrellaCollege("University of Wisconsin-La Crosse"), false);
  assert.equal(isSystemUmbrellaCollege("Crafton Hills College"), false);
  assert.equal(isSystemUmbrellaCollege("San Bernardino Valley College"), false);
  assert.equal(isSystemUmbrellaCollege("Miami University-Hamilton"), false);
  assert.equal(isSystemUmbrellaCollege("Miami University-Middletown"), false);
});

test("drops the University of Hawaii System copy when it duplicates a specific campus by exact URL (issue #119)", () => {
  const url = "https://www.schooljobs.com/careers/hawaiiedu/jobs/5067228/assistant-professor";
  const jobs = [
    job({
      url,
      title: "Assistant Professor of General Public Administration",
      college: "University of Hawaii-West Oahu",
      location: "University of Hawaii-West Oahu, HI",
      department: "University of Hawai'i - West O'ahu - Academic Affairs (L)",
    }),
    job({
      url,
      title: "Assistant Professor of General Public Administration",
      college: "University of Hawaii System",
      location: "Honolulu, HI",
      department: "General Public Administration",
    }),
  ];

  const { jobs: result, dropped } = consolidateSystemUmbrellaDuplicates(jobs);
  assert.equal(result.length, 1);
  assert.equal(result[0].college, "University of Hawaii-West Oahu");
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].college, "University of Hawaii System");
});

test("drops UW System Comprehensives, Indiana University, and University of Alaska System duplicate copies", () => {
  const cases = [
    {
      url: "https://wisconsin.wd1.myworkdayjobs.com/UW_Comprehensives/job/La-Crosse-WI/Assistant-Professor_JR1",
      keep: "University of Wisconsin-La Crosse",
      drop: "UW System Comprehensives",
    },
    {
      url: "https://indiana.peopleadmin.com/postings/33959",
      keep: "Indiana University-Bloomington",
      drop: "Indiana University",
    },
    {
      url: "https://careers.alaska.edu/jobs/assistant-professor-of-accounting",
      keep: "University of Alaska Anchorage",
      drop: "University of Alaska System",
    },
    {
      url: "https://careers.pageuppeople.com/967/cw/en-us/job/499731/assistant-professor",
      keep: "University of Connecticut-Avery Point",
      drop: "University of Connecticut",
    },
  ];

  for (const { url, keep, drop } of cases) {
    const jobs = [job({ url, college: keep }), job({ url, college: drop })];
    const { jobs: result, dropped } = consolidateSystemUmbrellaDuplicates(jobs);
    assert.equal(result.length, 1, `expected exactly one survivor for ${drop}/${keep}`);
    assert.equal(result[0].college, keep);
    assert.equal(dropped.length, 1);
    assert.equal(dropped[0].college, drop);
  }
});

test("leaves Crafton Hills College / San Bernardino Valley College's genuine either-campus postings untouched (issue #133 / PR #134)", () => {
  const url = "https://www.schooljobs.com/careers/sbccd/jobs/4066026/adjunct-professor-accounting";
  const jobs = [
    job({ url, college: "Crafton Hills College", location: "Crafton Hills College, CA" }),
    job({ url, college: "San Bernardino Valley College", location: "San Bernardino Valley College, CA" }),
  ];

  const { jobs: result, dropped } = consolidateSystemUmbrellaDuplicates(jobs);
  assert.equal(result.length, 2);
  assert.equal(dropped.length, 0);
  const colleges = new Set(result.map((j) => j.college));
  assert.equal(colleges.has("Crafton Hills College"), true);
  assert.equal(colleges.has("San Bernardino Valley College"), true);
});

test("leaves Miami University-Hamilton / Miami University-Middletown's shared postings untouched", () => {
  const url = "https://miamioh.wd5.myworkdayjobs.com/miamioh-faculty/job/Farmer-School-of-Business/Assistant-Professor_JR1";
  const jobs = [
    job({ url, college: "Miami University-Hamilton", location: "Miami University-Hamilton, OH" }),
    job({ url, college: "Miami University-Middletown", location: "Miami University-Middletown, OH" }),
  ];

  const { jobs: result, dropped } = consolidateSystemUmbrellaDuplicates(jobs);
  assert.equal(result.length, 2);
  assert.equal(dropped.length, 0);
});

test("leaves unrelated postings with different URLs, or a single college, untouched", () => {
  const jobs = [
    job({ url: "https://example.edu/postings/1", college: "University of Hawaii System" }),
    job({ url: "https://example.edu/postings/2", college: "University of Hawaii-Manoa", title: "Lecturer" }),
    job({ url: "https://example.edu/postings/3", college: "Pomona College", title: "Lecturer" }),
  ];

  const { jobs: result, dropped } = consolidateSystemUmbrellaDuplicates(jobs);
  assert.equal(result.length, 3);
  assert.equal(dropped.length, 0);
});

test("does not drop an umbrella copy when the URL is shared by two or more DIFFERENT specific campuses", () => {
  // Defensive case: if a URL is ever shared by an umbrella label AND two
  // different specific campuses, that's an ambiguous, out-of-scope
  // collision (not a simple umbrella-vs-one-campus duplicate) and every
  // copy should be left alone rather than guessing which campus to keep.
  const url = "https://example.edu/postings/ambiguous";
  const jobs = [
    job({ url, college: "University of Hawaii System" }),
    job({ url, college: "University of Hawaii-West Oahu" }),
    job({ url, college: "University of Hawaii at Manoa" }),
  ];

  const { jobs: result, dropped } = consolidateSystemUmbrellaDuplicates(jobs);
  assert.equal(result.length, 3);
  assert.equal(dropped.length, 0);
});

test("does not merge across genuinely different titles at the same URL", () => {
  const url = "https://example.edu/postings/multi-role";
  const jobs = [
    job({ url, college: "University of Hawaii System", title: "Lecturer Pool" }),
    job({ url, college: "University of Hawaii-West Oahu", title: "Assistant Professor" }),
  ];

  const { jobs: result, dropped } = consolidateSystemUmbrellaDuplicates(jobs);
  assert.equal(result.length, 2);
  assert.equal(dropped.length, 0);
});

// Issue #159: University of Arkansas's shared uasys.wd5.myworkdayjobs.com
// tenant exposes the SAME requisition through the institution-specific site
// path (Fayetteville's /UAF_External_Career_Site, UAMS's /UAMS_All_Careers)
// and again through the unscoped /UASYS site, with a terminal "-1" copy
// suffix Workday appends to the second exposure -- a different URL from the
// original, so consolidateSystemUmbrellaDuplicates's exact-URL match can't
// catch it. consolidateWorkdayRequisitionDuplicates matches by (tenant host,
// base requisition id) instead.
test("drops the University of Arkansas System Office copy of a Fayetteville requisition (issue #159)", () => {
  const jobs = [
    job({
      url: "https://uasys.wd5.myworkdayjobs.com/UAF_External_Career_Site/job/Fayetteville/Assistant-Professor-in-Computational-Methods-in-Math_R0091502",
      title: "Assistant Professor in Computational Methods in Math",
      college: "University of Arkansas",
      location: "Fayetteville, AR",
    }),
    job({
      url: "https://uasys.wd5.myworkdayjobs.com/UASYS/job/Fayetteville/Assistant-Professor-in-Computational-Methods-in-Math_R0091502-1",
      title: "Assistant Professor in Computational Methods in Math",
      college: "University of Arkansas System Office",
      location: "Fayetteville, AR",
    }),
  ];

  const { jobs: result, dropped } = consolidateWorkdayRequisitionDuplicates(jobs);
  assert.equal(result.length, 1);
  assert.equal(result[0].college, "University of Arkansas");
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].college, "University of Arkansas System Office");
});

test("drops the University of Arkansas System Office copy of a UAMS requisition (issue #159)", () => {
  const jobs = [
    job({
      url: "https://uasys.wd5.myworkdayjobs.com/UAMS_All_Careers/job/UAMS/Adult-Gerontology-Acute-Care-Professor_R0091228",
      title: "Adult-Gerontology Acute Care Professor/Assistant Professor or Associate Professor",
      college: "University of Arkansas for Medical Sciences",
      location: "UAMS, AR",
    }),
    job({
      url: "https://uasys.wd5.myworkdayjobs.com/UASYS/job/UAMS/Adult-Gerontology-Acute-Care-Professor_R0091228-1",
      title: "Adult-Gerontology Acute Care Professor/Assistant Professor or Associate Professor",
      college: "University of Arkansas System Office",
      location: "UAMS, AR",
    }),
  ];

  const { jobs: result, dropped } = consolidateWorkdayRequisitionDuplicates(jobs);
  assert.equal(result.length, 1);
  assert.equal(result[0].college, "University of Arkansas for Medical Sciences");
  assert.equal(dropped.length, 1);
});

test("consolidateWorkdayRequisitionDuplicates leaves non-Workday hosts, single copies, and genuinely different requisitions untouched", () => {
  const jobs = [
    job({ url: "https://example.edu/postings/R0091502", college: "University of Arkansas System Office" }),
    job({
      url: "https://uasys.wd5.myworkdayjobs.com/UAF_External_Career_Site/job/Fayetteville/Only-Copy_R0099999",
      college: "University of Arkansas",
    }),
    job({
      url: "https://uasys.wd5.myworkdayjobs.com/UAF_External_Career_Site/job/Fayetteville/Different-Req_R0011111",
      college: "University of Arkansas",
    }),
    job({
      url: "https://uasys.wd5.myworkdayjobs.com/UASYS/job/Fayetteville/Different-Req_R0022222-1",
      college: "University of Arkansas System Office",
    }),
  ];

  const { jobs: result, dropped } = consolidateWorkdayRequisitionDuplicates(jobs);
  assert.equal(result.length, jobs.length);
  assert.equal(dropped.length, 0);
});

test("does not drop a System Office copy when two DIFFERENT specific campuses share the base requisition id", () => {
  const jobs = [
    job({
      url: "https://uasys.wd5.myworkdayjobs.com/UAF_External_Career_Site/job/Fayetteville/Ambiguous_R0000001",
      college: "University of Arkansas",
    }),
    job({
      url: "https://uasys.wd5.myworkdayjobs.com/UAMS_All_Careers/job/UAMS/Ambiguous_R0000001-2",
      college: "University of Arkansas for Medical Sciences",
    }),
    job({
      url: "https://uasys.wd5.myworkdayjobs.com/UASYS/job/Fayetteville/Ambiguous_R0000001-1",
      college: "University of Arkansas System Office",
    }),
  ];

  const { jobs: result, dropped } = consolidateWorkdayRequisitionDuplicates(jobs);
  assert.equal(result.length, 3);
  assert.equal(dropped.length, 0);
});
