import assert from "node:assert/strict";
import test from "node:test";

import { extractRequisitionId, computeCanonicalGroupId, attachCanonicalIds } from "../lib/canonical-id.js";

// Issue #135: canonicalGroupId previously hashed only
// `title|college|department|state`, so genuinely distinct requisitions that
// happened to share those four fields collapsed into one canonical group and
// the frontend rendered only one card for several unrelated openings. Each
// test below is one of the issue's confirmed real-world examples.

test("extractRequisitionId reads the TAMU JobId query parameter", () => {
  const a = extractRequisitionId("https://faculty.tamu.edu/JobDetail.aspx?PositionId=179558&JobId=183029");
  const b = extractRequisitionId("https://faculty.tamu.edu/JobDetail.aspx?PositionId=185494&JobId=188488");
  assert.notEqual(a, null);
  assert.notEqual(b, null);
  assert.notEqual(a, b);
});

test("extractRequisitionId reads a Workday requisition suffix, ignoring a reprint '-N' suffix", () => {
  const a = extractRequisitionId("https://example.wd1.myworkdayjobs.com/External/job/Site/Adjunct-Faculty--Biology_JR0000108187");
  const b = extractRequisitionId("https://example.wd1.myworkdayjobs.com/External/job/Site/Adjunct-Faculty--Biology_JR0000108188");
  assert.notEqual(a, null);
  assert.notEqual(a, b);
  // A "-1" reprint suffix is the same requisition, not a different one.
  assert.equal(
    extractRequisitionId("https://example.wd1.myworkdayjobs.com/External/job/Site/Adjunct-Faculty--Accounting_JR101035"),
    extractRequisitionId("https://example.wd1.myworkdayjobs.com/External/job/Site/Adjunct-Faculty--Accounting_JR101035-1")
  );
});

test("extractRequisitionId reads a Workday requisition id with an underscore before the digits (UT Austin shape)", () => {
  const a = extractRequisitionId("https://utaustin.wd1.myworkdayjobs.com/UTstaff/job/AUSTIN-TX/Postdoctoral-Fellow_R_00048760-1");
  const b = extractRequisitionId("https://utaustin.wd1.myworkdayjobs.com/UTstaff/job/AUSTIN-TX/Postdoctoral-Fellow_R_00046894-1");
  assert.notEqual(a, null);
  assert.notEqual(a, b);
});

test("extractRequisitionId reads a PeopleAdmin stable posting id", () => {
  assert.notEqual(extractRequisitionId("https://jobs.geneseo.edu/postings/5637"), null);
  assert.notEqual(
    extractRequisitionId("https://jobs.geneseo.edu/postings/5637"),
    extractRequisitionId("https://jobs.geneseo.edu/postings/5638")
  );
});

test("extractRequisitionId reads a PageUp numeric job id (SUNY Downstate shape)", () => {
  const a = extractRequisitionId("https://careers.pageuppeople.com/977/cw/en-us/job/497215");
  const b = extractRequisitionId("https://careers.pageuppeople.com/977/cw/en-us/job/497216");
  assert.notEqual(a, null);
  assert.notEqual(a, b);
});

test("extractRequisitionId reads a trailing UUID (PageUp/vendor career-site shape, Michigan State)", () => {
  const a = extractRequisitionId(
    "https://careers.msu.edu/jobs/associate-full-professor-tenure-system-flint-michigan-united-states-895e1923-fc94-4c55-ab79-49f75277e805"
  );
  const b = extractRequisitionId(
    "https://careers.msu.edu/jobs/associate-full-professor-tenure-system-flint-michigan-united-states-bfa979ef-b744-4e70-8f66-2fe3a4998bb2"
  );
  assert.notEqual(a, null);
  assert.notEqual(a, b);
});

test("extractRequisitionId returns null when no known stable-id shape is present", () => {
  assert.equal(extractRequisitionId("https://example.edu/careers"), null);
  assert.equal(extractRequisitionId(""), null);
  assert.equal(extractRequisitionId(null), null);
});

test("computeCanonicalGroupId keeps Texas A&M's three same-titled, different-requisition searches separate (issue #135)", () => {
  const base = {
    titleClean: "Academic Professional Track (Non-Tenure): Clinical Assistant Professor or Clinical Associate Professor",
    college: "Texas A&M University",
    department: null,
    state: "TX",
  };
  const ids = new Set([
    computeCanonicalGroupId({ ...base, url: "https://faculty.tamu.edu/JobDetail.aspx?PositionId=179558&JobId=183029" }),
    computeCanonicalGroupId({ ...base, url: "https://faculty.tamu.edu/JobDetail.aspx?PositionId=185494&JobId=188488" }),
    computeCanonicalGroupId({ ...base, url: "https://faculty.tamu.edu/JobDetail.aspx?PositionId=180866&JobId=184188" }),
  ]);
  assert.equal(ids.size, 3);
});

test("computeCanonicalGroupId keeps Michigan State's three identically-titled Flint searches separate (issue #135)", () => {
  const base = {
    titleClean: "Associate/Full Professor of Human Medicine - Tenure System",
    college: "Michigan State University",
    department: "College of Human Medicine",
    state: "MI",
    location: "East Lansing, MI",
  };
  const ids = new Set([
    computeCanonicalGroupId({
      ...base,
      url: "https://careers.msu.edu/jobs/associate-full-professor-tenure-system-flint-michigan-united-states-895e1923-fc94-4c55-ab79-49f75277e805",
    }),
    computeCanonicalGroupId({
      ...base,
      url: "https://careers.msu.edu/jobs/associate-full-professor-tenure-system-flint-michigan-united-states-bfa979ef-b744-4e70-8f66-2fe3a4998bb2",
    }),
    computeCanonicalGroupId({
      ...base,
      url: "https://careers.msu.edu/jobs/associate-full-professor-tenure-system-flint-michigan-united-states-86556cc5-396d-471e-b100-1e0d63e7d387",
    }),
  ]);
  assert.equal(ids.size, 3);
});

test("computeCanonicalGroupId keeps SUNY Downstate's identically-titled PageUp requisitions separate (issue #135)", () => {
  const base = {
    titleClean: "Adjunct Instructor, College of Nursing",
    college: "SUNY Downstate Health Sciences University",
    department: "College of Nursing",
    state: "NY",
  };
  const ids = new Set([
    "496950",
    "496951",
    "496952",
  ].map((id) => computeCanonicalGroupId({ ...base, url: `https://careers.pageuppeople.com/977/cw/en-us/job/${id}` })));
  assert.equal(ids.size, 3);
});

test("computeCanonicalGroupId still groups two representations of the exact same posting (no requisition id, same everything)", () => {
  const a = computeCanonicalGroupId({
    titleClean: "Assistant Professor of Biology",
    college: "Example College",
    department: "Biology",
    state: "OH",
    location: "Columbus, OH",
    url: "https://example.edu/jobs/1",
  });
  const b = computeCanonicalGroupId({
    titleClean: "Assistant Professor of Biology",
    college: "Example College",
    department: "Biology",
    state: "OH",
    location: "Columbus, OH",
    url: "https://example.edu/jobs/1?utm_source=x",
  });
  assert.equal(a, b);
});

test("computeCanonicalGroupId still separates same title/college/department postings in different cities with no extractable id", () => {
  const a = computeCanonicalGroupId({
    titleClean: "Adjunct Faculty - Biology",
    college: "Ivy Tech Community College",
    department: "Biology",
    state: "IN",
    location: "Indianapolis, IN",
    url: "https://example.edu/careers/generic-search-result",
  });
  const b = computeCanonicalGroupId({
    titleClean: "Adjunct Faculty - Biology",
    college: "Ivy Tech Community College",
    department: "Biology",
    state: "IN",
    location: "Sellersburg, IN",
    url: "https://example.edu/careers/generic-search-result",
  });
  assert.notEqual(a, b);
});

test("attachCanonicalIds always recomputes IDs from current field values rather than preserving stale ones", () => {
  const [job] = attachCanonicalIds([
    { title: "Assistant Professor", college: "Example College", canonicalGroupId: "stale", canonicalJobId: "stale" },
  ]);
  assert.notEqual(job.canonicalGroupId, "stale");
  assert.notEqual(job.canonicalJobId, "stale");
});

// Follow-up to issue #135: with the requisition-ID fix live, 228 canonical
// groups (675 records) still held more than one record. Most turned out to
// be genuine same-posting duplicate representations on platforms without an
// extractable stable id (BambooHR, SelectMinds, ...) -- exactly as expected.
// The tests below cover the URL shapes that DID have an extractable id
// hiding in them, plus the dataset-wide safety net that keeps extracting
// those new ids from re-introducing the over-collapse bug in a new form.

test("extractRequisitionId reads a job_id (underscore) query parameter (UW shape)", () => {
  const a = extractRequisitionId("https://ap.washington.edu/ahr/position-details?job_id=186094");
  const b = extractRequisitionId("https://ap.washington.edu/ahr/position-details?job_id=186528");
  assert.notEqual(a, null);
  assert.notEqual(a, b);
});

test("extractRequisitionId reads an opportunityId query parameter (UltiPro shape)", () => {
  const a = extractRequisitionId(
    "https://recruiting2.ultipro.com/CHA1037CHRS/JobBoard/7fb6ae1e-e3f6-44ac-8694-2577af27ab6b/OpportunityDetail?opportunityId=fd3d6b35-6462-4d3d-b39d-ee8463cd8198"
  );
  const b = extractRequisitionId(
    "https://recruiting2.ultipro.com/CHA1037CHRS/JobBoard/7fb6ae1e-e3f6-44ac-8694-2577af27ab6b/OpportunityDetail?opportunityId=5e390081-30ac-4c9b-ae44-fb385e38cef4"
  );
  assert.notEqual(a, null);
  assert.notEqual(a, b);
});

test("extractRequisitionId reads a jobId encoded in the URL hash fragment (Oracle PeopleSoft shape)", () => {
  const a = extractRequisitionId(
    "https://careers.hprod.onehcm.usg.edu/psc/careers/CAREERS/HRMS/c/HRS_HRAM_FL.HRS_CG_SEARCH_FL.GBL?FOCUS=Applicant&SiteId=03000#jobId=296346"
  );
  const b = extractRequisitionId(
    "https://careers.hprod.onehcm.usg.edu/psc/careers/CAREERS/HRMS/c/HRS_HRAM_FL.HRS_CG_SEARCH_FL.GBL?FOCUS=Applicant&SiteId=03000#jobId=272596"
  );
  assert.notEqual(a, null);
  assert.notEqual(a, b);
});

test("extractRequisitionId reads a PageUp numeric job id followed by a human-readable slug segment", () => {
  const a = extractRequisitionId("https://careers.pageuppeople.com/876/cw/en-us/job/499139/clinical-preclinical-instructor");
  const b = extractRequisitionId("https://careers.pageuppeople.com/876/cw/en-us/job/499140/clinical-preclinical-instructor");
  assert.notEqual(a, null);
  assert.notEqual(a, b);
});

test("extractRequisitionId reads Workday requisition ids that use REQ/RQ prefixes or a hyphen separator", () => {
  const reqUnderscore = extractRequisitionId(
    "https://psu.wd1.myworkdayjobs.com/PSU_Academic/job/Penn-State-University-Park/Faculty_REQ_0000079176-2"
  );
  const rq = extractRequisitionId("https://massgeneralbrigham.wd1.myworkdayjobs.com/MGBExternal/job/Charlestown-MA/Faculty_RQ4071921");
  const rHyphen = extractRequisitionId(
    "https://austincc.wd1.myworkdayjobs.com/External/job/Austin-Community-College/Adjunct-Faculty--Health---Kinesiology_R-9722"
  );
  assert.notEqual(reqUnderscore, null);
  assert.notEqual(rq, null);
  assert.notEqual(rHyphen, null);
  assert.notEqual(
    extractRequisitionId(
      "https://austincc.wd1.myworkdayjobs.com/External/job/Austin-Community-College/Adjunct-Faculty--Health---Kinesiology_R-9739"
    ),
    rHyphen
  );
});

test("extractRequisitionId reads a bare-numeric Workday requisition id (no letter prefix)", () => {
  const a = extractRequisitionId(
    "https://cmu.wd5.myworkdayjobs.com/CMU/job/Pittsburgh-PA/Postdoctoral-Fellow---Robotics-Institute_2023679"
  );
  const b = extractRequisitionId(
    "https://cmu.wd5.myworkdayjobs.com/CMU/job/Pittsburgh-PA/Postdoctoral-Fellow---Robotics-Institute_2024241"
  );
  assert.notEqual(a, null);
  assert.notEqual(a, b);
});

test("extractRequisitionId reads a {year}-{sequence} Workday requisition id, distinct from a reprint suffix", () => {
  const a = extractRequisitionId("https://slu.wd5.myworkdayjobs.com/Careers/job/Schroeder-Hall/Adjunct-Faculty_2026-10084");
  const b = extractRequisitionId("https://slu.wd5.myworkdayjobs.com/Careers/job/Schroeder-Hall/Adjunct-Faculty_2026-09937");
  assert.notEqual(a, null);
  assert.notEqual(a, b);
  assert.equal(
    extractRequisitionId("https://slu.wd5.myworkdayjobs.com/Careers/job/SLU-Saint-Louis-MO/Adjunct---Mathematics_2021-02690"),
    extractRequisitionId("https://slu.wd5.myworkdayjobs.com/Careers/job/SLU-Saint-Louis-MO/Adjunct---Mathematics_2021-02690-1")
  );
});

test("extractRequisitionId reads generic vendor '{jobs|careers|requisition|preview}/{id}' shapes", () => {
  assert.notEqual(
    extractRequisitionId("https://careers.mountsinai.org/jobs/3040581"),
    extractRequisitionId("https://careers.mountsinai.org/jobs/3042310")
  );
  assert.notEqual(
    extractRequisitionId("https://usm.csod.com/ux/ats/careersite/1/home/requisition/5195?c=usm"),
    extractRequisitionId("https://usm.csod.com/ux/ats/careersite/1/home/requisition/5131?c=usm")
  );
  assert.notEqual(
    extractRequisitionId("https://ebyf.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/jobs/preview/76?mode=location"),
    extractRequisitionId("https://ebyf.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/jobs/preview/140?mode=location")
  );
});

test("extractRequisitionId does not mistake a Paycom tenant-portal GUID for the per-posting id", () => {
  const a = extractRequisitionId("https://www.paycomonline.net/v4/ats/web.php/portal/6E871BCB0EFD76A7A4C5061C331B232C/jobs/582777");
  const b = extractRequisitionId("https://www.paycomonline.net/v4/ats/web.php/portal/6E871BCB0EFD76A7A4C5061C331B232C/jobs/581638");
  assert.notEqual(a, null);
  assert.notEqual(a, b);
  // Neither id should be the shared portal GUID itself.
  assert.ok(!a.includes("6e871bcb0efd76a7a4c5061c331b232c"));
  assert.ok(!b.includes("6e871bcb0efd76a7a4c5061c331b232c"));
});

test("extractRequisitionId reads a bare 32-hex-char id path segment (cuny.jobs shape)", () => {
  const a = extractRequisitionId(
    "https://cuny.jobs/brooklyn-ny/adjunct-faculty-open-rank-baking-pastry/F8569262C2B64D0E9B33F1E22655655C/job"
  );
  const b = extractRequisitionId(
    "https://cuny.jobs/brooklyn-ny/adjunct-faculty-open-rank-culinary-arts/462C529C8EE34AB3964BBF3DF49FFE67/job"
  );
  assert.notEqual(a, null);
  assert.notEqual(a, b);
});

test("extractRequisitionId reads a BambooHR careers id (task's named example, WVU Parkersburg shape)", () => {
  const a = extractRequisitionId("https://wvup.bamboohr.com/careers/71");
  const b = extractRequisitionId("https://wvup.bamboohr.com/careers/81");
  assert.notEqual(a, null);
  assert.notEqual(a, b);
});

test("extractRequisitionId reads an Interfolio id, the entire path", () => {
  const a = extractRequisitionId("https://apply.interfolio.com/183091");
  const b = extractRequisitionId("https://apply.interfolio.com/187646");
  assert.notEqual(a, null);
  assert.notEqual(a, b);
});

test("extractRequisitionId reads an ApplicantStack detail id", () => {
  const a = extractRequisitionId("https://udc.applicantstack.com/x/detail/a2hbyxhtt6l4");
  const b = extractRequisitionId("https://udc.applicantstack.com/x/detail/a2hbyxhkpbs8");
  assert.notEqual(a, null);
  assert.notEqual(a, b);
});

test("extractRequisitionId reads a trailing hyphen-numeric slug suffix (task's named SelectMinds example, plus UTMB)", () => {
  const a = extractRequisitionId("https://uthscsa.referrals.selectminds.com/faculty/jobs/adjunct-assistant-professor-9937");
  const b = extractRequisitionId("https://uthscsa.referrals.selectminds.com/faculty/jobs/adjunct-assistant-professor-337");
  assert.notEqual(a, null);
  assert.notEqual(a, b);
  assert.notEqual(
    extractRequisitionId("https://applyjobs.utmb.edu/jobs/assistant-professor-otolaryngology-35602"),
    extractRequisitionId("https://applyjobs.utmb.edu/jobs/assistant-professor-otolaryngology-33578")
  );
});

test("extractRequisitionId ignores a single trailing digit as a slug suffix (lvhn.org shape, not a confirmed stable id)", () => {
  assert.equal(extractRequisitionId("https://www.lvhn.org/job/adjunct-nursing-instructor-3"), null);
});

test("extractRequisitionId reads a Taleo-style bare numeric id after a 'job' path segment (Duke shape)", () => {
  const a = extractRequisitionId("https://careers.duke.edu/job/Durham-Postdoctoral-Associate-NC-27710/1410017400");
  const b = extractRequisitionId("https://careers.duke.edu/job/Durham-Postdoctoral-Associate-NC-27710/1382542600");
  assert.notEqual(a, null);
  assert.notEqual(a, b);
});

test("extractRequisitionId does not treat a Drupal '/node/{id}' content id as a requisition id", () => {
  // Bryn Mawr publishes the same posting at both a pretty alias URL and this
  // bare node-id URL, with no id at all in the alias -- treating the node id
  // as a stable requisition id would split that one posting's two URL forms
  // into two canonical groups instead of keeping them together.
  assert.equal(extractRequisitionId("https://www.brynmawr.edu/node/133747"), null);
});

test("attachCanonicalIds does not split a same-posting mirror where only one side has an extractable id", () => {
  // jobs.la.gov's generic "Application Information" page and the real
  // governmentjobs.com posting it mirrors: same title/college/location, only
  // one side's URL shape yields an id.
  const jobs = [
    {
      title: "Adjunct Instructor",
      college: "Bossier Parish Community College",
      location: "Bossier City, LA",
      url: "https://jobs.la.gov/ApplicantInformation/ImportantApplicationInformation.aspx#appStatus",
    },
    {
      title: "Adjunct Instructor",
      college: "Bossier Parish Community College",
      location: "Bossier City, LA",
      url: "https://www.governmentjobs.com/careers/louisiana/jobs/4942034/adjunct-instructor",
    },
  ];
  const [a, b] = attachCanonicalIds(jobs);
  assert.equal(a.canonicalGroupId, b.canonicalGroupId);
});

test("attachCanonicalIds does not split a same-posting mirror where both sides share one extracted id (Bryn Mawr node/alias shape)", () => {
  const jobs = [
    {
      title: "Assistant Professor of Political Science",
      college: "Bryn Mawr College",
      location: "Bryn Mawr, PA",
      url: "https://www.brynmawr.edu/inside/academic-information/office-provost/open-faculty-positions/assistant-professor-political-science",
    },
    {
      title: "Assistant Professor of Political Science",
      college: "Bryn Mawr College",
      location: "Bryn Mawr, PA",
      url: "https://www.brynmawr.edu/node/133747",
    },
  ];
  const [a, b] = attachCanonicalIds(jobs);
  assert.equal(a.canonicalGroupId, b.canonicalGroupId);
});

test("attachCanonicalIds still separates a fallback-key cluster with genuinely plural distinct ids", () => {
  const base = { title: "Adjunct Faculty", college: "Example College", location: "Example, TX" };
  const jobs = [
    { ...base, url: "https://example.wd1.myworkdayjobs.com/job/Example-TX/Adjunct-Faculty_R-1001", description: "Teach section A." },
    { ...base, url: "https://example.wd1.myworkdayjobs.com/job/Example-TX/Adjunct-Faculty_R-1002", description: "Teach section B." },
    { ...base, url: "https://example.wd1.myworkdayjobs.com/job/Example-TX/Adjunct-Faculty_R-1003", description: "Teach section C." },
  ];
  const [a, b, c] = attachCanonicalIds(jobs);
  assert.equal(new Set([a.canonicalGroupId, b.canonicalGroupId, c.canonicalGroupId]).size, 3);
});

test("attachCanonicalIds merges two different ids whose full descriptions are byte-identical (task's named BambooHR example)", () => {
  // wvup.bamboohr.com/careers/71 and /careers/81: same title, location, and
  // full description -- a repost of the same opening under a new id, not two
  // different requisitions, even though the ids and the "distinct id count"
  // heuristic alone would otherwise say "separate these".
  const base = {
    title: "Nursing Faculty",
    college: "West Virginia University at Parkersburg",
    location: "Morgantown, WV",
    description: "Identical boilerplate posting text.",
  };
  const jobs = [
    { ...base, url: "https://wvup.bamboohr.com/careers/71" },
    { ...base, url: "https://wvup.bamboohr.com/careers/81" },
  ];
  const [a, b] = attachCanonicalIds(jobs);
  assert.equal(a.canonicalGroupId, b.canonicalGroupId);
});

test("attachCanonicalIds only merges the specific duplicate-content pair within a large cluster, not the whole cluster (Texas A&M shape)", () => {
  // 21 real Texas A&M postings can share this exact generic title/college
  // with no department, and one coincidental description match among them
  // must not drag the other 19 back into one over-collapsed group.
  const base = { title: "Tenure-Track: Assistant Professor", college: "Texas A&M University", location: "College Station, TX" };
  const jobs = [
    { ...base, url: "https://faculty.tamu.edu/JobDetail.aspx?JobId=1", description: "Biology search." },
    { ...base, url: "https://faculty.tamu.edu/JobDetail.aspx?JobId=2", description: "Biology search." },
    { ...base, url: "https://faculty.tamu.edu/JobDetail.aspx?JobId=3", description: "Chemistry search." },
    { ...base, url: "https://faculty.tamu.edu/JobDetail.aspx?JobId=4", description: "Physics search." },
  ];
  const [a, b, c, d] = attachCanonicalIds(jobs);
  assert.equal(a.canonicalGroupId, b.canonicalGroupId);
  assert.equal(new Set([a.canonicalGroupId, c.canonicalGroupId, d.canonicalGroupId]).size, 3);
});
