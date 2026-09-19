import assert from "node:assert/strict";
import test from "node:test";
import {
  confirmedNonFacultyReason,
  deterministicStratifiedSample,
  isPlaceholderLocation,
  scoreCatalog,
  scorePost,
  stableJobId,
  summarizeHumanLabels,
} from "../lib/post-quality.js";

const TODAY = new Date("2026-08-27T12:00:00Z");

function job(overrides = {}) {
  return {
    title: "Assistant Professor of Biology",
    college: "Example University",
    source: "EX",
    url: "https://jobs.example.edu/postings/1234",
    description: "Teach undergraduate biology courses, maintain a research program, and advise students in the department.",
    department: "Biology",
    location: "Phoenix, AZ",
    datePosted: "2026-08-01",
    closeDate: "2026-10-01",
    ...overrides,
  };
}

test("a complete direct faculty appointment passes with a high score", () => {
  const quality = scorePost(job(), { today: TODAY });
  assert.equal(quality.status, "pass");
  assert.ok(quality.score >= 95);
  assert.deepEqual(quality.reasons, []);
});

test("faculty resource page titles are quarantined with a reason code", () => {
  const quality = scorePost(job({ title: "Faculty Affairs" }), { today: TODAY });
  assert.equal(quality.status, "quarantine");
  assert.ok(quality.reasons.some((reason) => reason.code === "resource_page_title"));
});

test("generic faculty handbooks, careers indexes, and staff portals are quarantined", () => {
  for (const title of [
    "Faculty Handbook",
    "Faculty Careers",
    "Faculty/Staff",
    "Faculty & Staff Resources",
    "/ Faculty/Staff Panel",
  ]) {
    assert.equal(confirmedNonFacultyReason(job({ title }), { today: TODAY }), "resource_page_title", title);
  }
});

test("faculty navigation, governance, awards, and news labels are quarantined", () => {
  for (const title of [
    "Current Faculty",
    "Faculty Bylaws",
    "Faculty Hard Copy Grades and Attendance Submission",
    "Faculty Learning Communities",
    "Faculty Roster",
    "Faculty Sabbaticals",
    "Faculty and Course Profiles",
    "Faculty Members",
    "Faculty Retirement Transition Leave",
    "Featured Faculty",
    "Staff/Faculty Webmail",
    "Welcoming Seven New Faculty Members",
    "Faculty and Providers",
    "Faculty Home",
    "My Faculty Jobs",
    "Stony Brook Faculty Positions",
    "Academic Affairs Available Faculty Positions",
    "Cypress College Professor Foster Stanback Named 2027 Orange County Teacher of the Year Nominee",
    "No Days Off: Aviation Faculty Member Runs Summer Camp for Small Pilots",
  ]) {
    assert.equal(confirmedNonFacultyReason(job({ title }), { today: TODAY }), "resource_page_title", title);
  }
  assert.equal(confirmedNonFacultyReason(job({ title: "Faculty, Nursing" }), { today: TODAY }), null);
});

test("faculty governance documents, directories, and employee portals are quarantined", () => {
  for (const title of [
    "Allocation of Faculty Resources",
    "Becoming a Faculty Member",
    "Directory (Faculty & Staff)",
    "Faculty & Employee Handbook",
    "Faculty Bylaws",
    "Faculty Committees",
    "Faculty Credentialing Policy",
    "Faculty Email",
    "Faculty Governance and Committees",
    "Faculty Housing",
    "Faculty Manual",
    "Faculty Policies and Procedures",
    "Office of Faculty Resources",
    "Procedures and Responsibilities Regarding Faculty",
    "Resources for Early-Career Faculty",
    "SECTION II: Faculty",
    "Teaching Faculty Policy Handbook",
  ]) {
    assert.equal(confirmedNonFacultyReason(job({ title }), { today: TODAY }), "resource_page_title", title);
  }
});

test("reviewed department faculty rosters are quarantined without catching ATS vacancies", () => {
  for (const candidate of [
    {
      college: "Brookdale Community College",
      title: "Accounting Faculty & Staff",
      url: "https://www.brookdalecc.edu/academic-institutes-and-departments/business-social-sciences/accounting-2/accounting-faculty-staff",
    },
    {
      college: "Northeastern Illinois University",
      title: "Mathematics Faculty",
      url: "https://www.neiu.edu/academics/colleges-departments/arts-and-sciences/departments/mathematics/mathematics-faculty",
    },
    {
      college: "Northeastern Illinois University",
      title: "Faculty Employment Opportunities",
      url: "https://www.neiu.edu/academics",
    },
    {
      college: "College of Biblical Studies-Houston",
      title: "Full-time Faculty",
      url: "https://cbshouston.edu/faculty#full-time",
    },
    {
      college: "New England College of Optometry",
      title: "Research Faculty",
      url: "https://www.neco.edu/research-innovation/graduate-faculty",
    },
    {
      college: "Northwest Mississippi Community College",
      title: "Fine Arts Faculty",
      url: "https://www.northwestms.edu/programs/academic/fine-arts-department/fine-arts-faculty",
    },
  ]) {
    assert.equal(confirmedNonFacultyReason(job(candidate), { today: TODAY }), "resource_page_title");
  }

  assert.equal(confirmedNonFacultyReason(job({
    college: "Brookdale Community College",
    title: "Faculty, Accounting",
    url: "https://jobs.example.edu/postings/123",
  }), { today: TODAY }), null);
});

test("faculty awards, policy, profile, research, and portal pages are quarantined", () => {
  for (const title of [
    "Faculty Appreciation Awards",
    "2021 Faculty Appreciation Awards",
    "Faculty Salary Scale",
    "Administration & Faculty",
    "Current Faculty",
    "Emeritus Faculty",
    "Faculty Emeritus",
    "Faculty Emeriti/ae",
    "Faculty Remembrances",
    "Faculty Roster",
    "Faculty Home",
    "Faculty Finder",
    "Faculty Vitae",
    "Featured Faculty",
    "Faculty Careers at St. Thomas",
    "Faculty Jobs@UIowa",
    "My Faculty Jobs",
    "Welcome to the Johns Hopkins University Faculty Careers site",
    "Faculty & Board Members",
    "Faculty & Staff Benefits",
    "Faculty and Course Profiles",
    "Faculty Employment Application",
    "Faculty Research & Publications",
    "Faculty Scholarship",
    "Faculty Publications",
    "Faculty Misconduct",
    "Faculty Publication Index",
    "Faculty/Staff Email",
    "Faculty + Staff",
    "Faculty & Staff Guide to Title IX",
    "Faculty assisted at Healthcare Careers Camp for high school students",
    "Faculty-led Research",
    "DAISY Award for Nursing Faculty",
    "Administraton, Leadership & Faculty",
    "Employment Opportunities :: Category - Faculty",
    "Faculty and Clinical Specialists",
    "For Faculty",
    "Full Time Faculty Expectations",
    "National Applied AI Consortium Spotlights Wright College Professor Gustavo Alatta",
    "Clinical/Professional Faculty Appointment and Promotion",
    "Faculty Comprehensive Checklist",
    "Faculty Emeritus/Emerita Guidelines",
    "Faculty Expectations",
    "Faculty Life & Development",
    "Faculty Positions & Hiring",
    "Faculty Recruiting Guidelines",
    "Faculty Rules of Procedure",
    "Faculty Self Service Banner (SSB9)",
    "Faculty Services",
    "Faculty/Staff Login",
    "Faculty/Staff Navigate Login",
    "Faculty and Staff Positions >",
    "Lecturer Hire Document Checklist",
    "Plan for Determining the Effectiveness of Student And Faculty Services",
    "Professional Development for Dance Instructors",
    "Spotlight on Faculty Culture",
    "Toggle Faculty Professional Development Menu",
    "College of the Siskiyous Paramedic Program Instructor Theresa Gowan Honored with Statewide Clinical Excellence Award",
    "Harold Washington College Professor Honored with National Maxwell/Hanrahan Award in Craft",
    "Professor Melda Beaty’s Sabbatical Revives Play Production Course at Olive-Harvey and Playwriting Award",
    "Christopher Newport University is a special place. We seek talented faculty and staff.",
    "AI Use: A How-To Guide for Instructors",
    "Faculty Contract",
    "Faculty Employment",
    "Faculty Guide to Ethical & Legal Standards in Student Hiring",
    "Faculty Negotiated Agreement",
    "Faculty PAWS",
    "Faculty Qualifications & Documentation Required",
    "Faculty Vacancy Announcements",
    "Faculty/Staff Portal (Okta Dashboard)",
    "For Faculty: Course Adoptions",
    "About MCC Faculty",
    "Faculty Annual Report Guide",
    "Faculty Advising Appointment Scheduling",
    "Faculty & Inventors",
    "Course Information & Faculty Credentials (House Bill 2504)",
    "Minimum Qualifications for Faculty and Administrators in California Community Colleges",
    "Staff and Faculty Orientation",
    "YSU Faculty Syllabi",
    "Faculty Assembly",
    "Faculty Books",
    "Faculty Labs",
    "Faculty Mentorship",
    "Faculty Position Openings",
    "Instructor Approved Prerequisite Override",
    "Research Appointments for Faculty",
    "Welcoming Seven New Faculty Members",
    "AR Professor of the Year",
    "Faculty (Business, Media & Writing)",
    "Faculty Members",
    "Malcolm X College Instructor Wins Prestigious Poetry Prize",
    "Stony Brook Faculty Positions",
    "Leadership & Faculty",
    "Program Leadership & Faculty",
    "Student-Faculty Research",
  ]) {
    assert.equal(confirmedNonFacultyReason(job({ title }), { today: TODAY }), "resource_page_title", title);
  }

  assert.equal(confirmedNonFacultyReason(job({
    college: "West Shore Community College",
    title: "Full Time Faculty",
    url: "https://www.westshore.edu/wp-content/uploads/2026/02/Benefit-Summary-Faculty-2026.pdf",
  }), { today: TODAY }), "resource_page_title");
  assert.equal(confirmedNonFacultyReason(job({
    college: "Covenant Theological Seminary",
    title: "Professor of New Testament",
  }), { today: TODAY }), "resource_page_title");
  assert.equal(confirmedNonFacultyReason(job({
    college: "Southern College of Optometry",
    title: "Residency Faculty",
  }), { today: TODAY }), "resource_page_title");
  assert.equal(confirmedNonFacultyReason(job({
    college: "College of Biblical Studies-Houston",
    title: "Dr. William Blocker President; Professor",
  }), { today: TODAY }), "resource_page_title");
  assert.equal(confirmedNonFacultyReason(job({
    college: "Western Michigan University Homer Stryker M.D. School of Medicine",
    title: "Executive Faculty",
  }), { today: TODAY }), "resource_page_title");
});

test("reviewed staff roles and student-services pages do not inflate the faculty inventory", () => {
  for (const title of [
    "Program Manager 1 - Graduate and Professional Programs",
    "Systems Analyst 2 - College of Pharmacy",
    "K14 Workforce Program Manager — 270101 - EAS MCECS Dean Maseeh College",
    "Program Manager L3 - (Manager of Faculty Awards, Titles, and Recognition)",
    "Senior Director Credentialing & Contracting (Hybrid) - Faculty Practice Plan",
    "Senior Policy & Research Manager, Office of the Faculty Director",
    "Shiley Dean's Office Student Assistant",
    "Student Affairs & Dean of Students",
    "Student Affairs-Dean of Students Office",
    "VSB Dean's Office Student Assistant",
  ]) {
    assert.equal(confirmedNonFacultyReason(job({ title })), "resource_page_title", title);
  }

  assert.equal(
    confirmedNonFacultyReason(job({ title: "Associate Dean for Medical Education and Professor" })),
    null
  );
});

test("reviewed dean assistants and athletics fundraising fellowships are staff records", () => {
  for (const [title, description] of [
    ["Assistant to the Dean", "Position Category Staff. Provides administrative support to the dean."],
    ["Bulldog Club (Fellow)", "Athletics support staff fellowship in fundraising and donor stewardship."],
    ["Director of Faculty Practice Operations, Dental", "Position Type Staff. Job Family Operations and Administrative Services."],
    ["Director, Center for Applied Artificial Intelligence/ Faculty Program Director", "Job Type Staff. Reports To Provost."],
    ["Patient Care Academy Instructor", "Position Type: Staff. Department: Patient Care Academy."],
    ["Registered Nurse Instructor", "Position Type Staff. Temporary/Permanent Temporary."],
    ["Riding Instructor/Eventing Coach", "Job Type Administrative Staff."],
    ["Welding Instructor and Lab Specialist", "Job Type Staff. Division Workforce Programs."],
    ["Workforce Instructor", "Job Type Staff. Department Workforce Development."],
    ["Yoga Instructor, FitWell Group Exercise", "Job Type Staff Part-Time."],
  ]) {
    assert.ok(confirmedNonFacultyReason({ title, description, url: "https://example.edu/jobs/123" }), title);
  }
});

test("informational-title cleanup does not catch substantive faculty appointments", () => {
  for (const title of [
    "Adjunct Faculty - Video Production I",
    "Adjunct Faculty, Film and Video",
    "Applicant Pool for Adjunct Faculty, Broadcasting/Video Production",
    "Associate Dean for Academic and Faculty Affairs",
    "Assistant Professor, Staff Veterinarian - Biomedical Resource Center",
    "Distinguished and Faculty Development Chairs in Materials Science",
    "E-Resource Management Librarian/Instructor of Library Services",
    "Professor of Public Policy",
    "Faculty Member, Biology",
    "Nursing Faculty",
    "Research Faculty",
    "Associate Faculty - Forestry/Natural Resources",
    "Assistant International Faculty and Scholar Advisor",
  ]) {
    assert.notEqual(confirmedNonFacultyReason(job({ title }), { today: TODAY }), "resource_page_title", title);
  }
});

test("faculty affairs staff roles are quarantined", () => {
  const quality = scorePost(job({ title: "Faculty Affairs Coordinator" }), { today: TODAY });
  assert.equal(quality.status, "quarantine");
  assert.ok(quality.reasons.some((reason) => reason.code === "administrative_staff_title"));
});

test("unambiguous student-services, administration, and recreation roles are quarantined", () => {
  for (const title of [
    "Assistant Dean of Student Affairs",
    "Associate Director for Faculty and Research Communications",
    "Dean of Enrollment Management",
    "Research Professional 2 - Chemical Engineering - Professor Bruggeman",
    "Climbing Wall Student Instructor",
    "Staff Instructor IV - Workforce",
    "Swim Instructor",
    "Yoga Instructor, FitWell Group Exercise",
  ]) {
    assert.equal(confirmedNonFacultyReason(job({ title }), { today: TODAY }), "nonacademic_staff_title", title);
  }
  assert.equal(confirmedNonFacultyReason(job({ title: "Assistant Professor of Physical Education" }), { today: TODAY }), null);
});

test("academic program names containing staff-role words remain eligible", () => {
  const quality = scorePost(job({ title: "Adjunct Faculty - Healthcare Specialist" }), { today: TODAY });
  assert.notEqual(quality.status, "quarantine");
  assert.ok(!quality.reasons.some((reason) => reason.code === "administrative_staff_title"));
});

test("open-rank and coordinated faculty appointments are not mistaken for staff roles", () => {
  for (const title of [
    "Glaucoma Ophthalmology Specialist - Faculty (Open Rank)",
    "Full Time Faculty (Program Coordinator) – Business Administration",
    "Program Coordinator / Clinical Assistant Faculty at 50% FTE",
    "Medical Assisting Program Coordinator/Faculty",
    "Retina/Uveitis Specialist - Faculty Rank DOQ",
    "Senior Faculty Specialist",
    "Specialist - Post Doc Psychology Fellow",
    "Distinguished and Faculty Development Chairs in Materials Science",
    "Assistant Librarian - Faculty Support Librarian",
  ]) {
    const quality = scorePost(job({ title }), { today: TODAY });
    assert.notEqual(quality.status, "quarantine", title);
    assert.ok(!quality.reasons.some((reason) => reason.code === "administrative_staff_title"), title);
  }
});

test("truncated institution text does not create a false attribution conflict", () => {
  const quality = scorePost(job({
    college: "University of Washington",
    title: "Restorative Neurosurgeon — Assistant Professor, WOT Neurological Surgery University of",
  }), { today: TODAY });
  assert.ok(!quality.reasons.some((reason) => reason.code === "institution_title_conflict"));
});

test("a university organizational unit is not mistaken for another institution", () => {
  const quality = scorePost(job({
    college: "University of Washington",
    title: "Associate Librarian or Librarian - Associate Dean, Research and Learning Services University Libraries",
  }), { today: TODAY });
  assert.ok(!quality.reasons.some((reason) => reason.code === "institution_title_conflict"));
});

test("the publishing gate removes only confirmed non-postings", () => {
  assert.equal(confirmedNonFacultyReason(job({ title: "Faculty Affairs Coordinator" }), { today: TODAY }), "administrative_staff_title");
  assert.equal(confirmedNonFacultyReason(job({
    title: "Faculty Awards",
    url: "https://www.example.edu/faculty-affairs/faculty-awards",
  }), { today: TODAY }), "resource_page_title");
  assert.equal(confirmedNonFacultyReason(job({ title: "Staff, Faculty & Student Employment Opportunities" }), { today: TODAY }), "resource_page_title");
  assert.equal(confirmedNonFacultyReason(job({ title: "Fellow Athletic Trainer - Baseball" }), { today: TODAY }), "nonacademic_staff_title");
  assert.equal(confirmedNonFacultyReason(job({ title: "Group Fitness Instructor (Adjunct)" }), { today: TODAY }), "nonacademic_staff_title");
  assert.equal(confirmedNonFacultyReason(job({ title: "Faculty/Staff Fitness Instructor Pool" }), { today: TODAY }), "nonacademic_staff_title");
  assert.equal(confirmedNonFacultyReason(job({ title: "WCL Dean's Fellow (Student)" }), { today: TODAY }), "student_service_title");
  assert.equal(confirmedNonFacultyReason(job({
    title: "Electrician Faculty - Greenville Center",
    description: "Teach electrician courses and provide quality education to students.",
  }), { today: TODAY }), null);
  assert.equal(confirmedNonFacultyReason(job({ title: "Assistant Professor of Biology" }), { today: TODAY }), null);
  assert.equal(confirmedNonFacultyReason(job({ title: "Assistant Professor of Exercise Science" }), { today: TODAY }), null);
});

test("source-labeled full-time staff records are not treated as faculty appointments", () => {
  const staff = job({
    title: "GED Instructor (Downtown)",
    description: "Department:Adult EducationType:Full-Time StaffLocation:Main Campus",
  });
  assert.equal(confirmedNonFacultyReason(staff, { today: TODAY }), "source_labeled_staff_role");
  assert.ok(scorePost(staff, { today: TODAY }).reasons.some((reason) => reason.code === "source_labeled_staff_role"));

  assert.equal(confirmedNonFacultyReason(job({
    title: "Electrical Technology Instructor",
    description: "Department:Electrical TechnologyType:Full-Time FacultyLocation:Main Campus",
  }), { today: TODAY }), null);
});

test("reviewed student-worker and transition job-coach records are quarantined", () => {
  for (const title of [
    "Student Worker - A&D Faculty Offices",
    "Job Coach & PreEts Instructor, Toledo Transition, Seasonal",
    "Assistant International Faculty and Scholar Advisor",
    "Faculty Services Assistant",
    "Personal Trainer, Duke Faculty Club",
  ]) {
    const result = scorePost(job({ title }), { today: TODAY });
    assert.equal(result.status, "quarantine", title);
    assert.ok(confirmedNonFacultyReason(job({ title })), title);
  }
});

test("a reviewed faculty retirement-incentive information page is quarantined", () => {
  const result = scorePost(job({ title: "Faculty Volunteer Early Retirement Incentive" }), { today: TODAY });
  assert.equal(result.status, "quarantine");
  assert.equal(confirmedNonFacultyReason(job({ title: "Faculty Volunteer Early Retirement Incentive" })), "resource_page_title");
});

test("adjunct appointments remain eligible when their subject resembles student services", () => {
  const quality = scorePost(job({ title: "Career Services Adjunct - Pet Grooming" }), { today: TODAY });
  assert.notEqual(quality.status, "quarantine");
  assert.ok(!quality.reasons.some((reason) => reason.code === "student_service_title"));
});

test("adjunct faculty recruitment remains an administrative role", () => {
  const quality = scorePost(job({ title: "Coordinator, Adjunct Faculty Recruitment" }), { today: TODAY });
  assert.equal(quality.status, "quarantine");
  assert.ok(quality.reasons.some((reason) => reason.code === "administrative_staff_title"));
});

test("associate faculty teaching human resources is not mistaken for HR staff", () => {
  const quality = scorePost(job({ title: "Associate Faculty - Labor Relations (Human Resources)" }), { today: TODAY });
  assert.equal(quality.status, "pass");
  assert.ok(!quality.reasons.some((reason) => reason.code === "administrative_staff_title"));
});

test("job-platform URLs containing faculty-affairs are not treated as resource pages", () => {
  const quality = scorePost(job({
    title: "Faculty Affairs Coordinator",
    url: "https://example.wd1.myworkdayjobs.com/careers/job/campus/Faculty-Affairs-Coordinator_R123",
  }), { today: TODAY });
  assert.ok(!quality.reasons.some((reason) => reason.code === "resource_page_url"));
  assert.ok(quality.reasons.some((reason) => reason.code === "administrative_staff_title"));
});

test("academic leadership titles are not mistaken for staff roles", () => {
  const quality = scorePost(job({ title: "Associate Dean and Professor for Faculty Affairs" }), { today: TODAY });
  assert.notEqual(quality.status, "quarantine");
  assert.ok(!quality.reasons.some((reason) => reason.code === "administrative_staff_title"));
});

test("a conflicting institution explicitly named in the title is quarantined", () => {
  const quality = scorePost(job({ title: "Assistant Professor — Other State University" }), { today: TODAY });
  assert.equal(quality.status, "quarantine");
  assert.ok(quality.reasons.some((reason) => reason.code === "institution_title_conflict"));
});

test("an expired posting is quarantined after the grace period unless marked open until filled", () => {
  const expired = scorePost(job({ closeDate: "2026-01-01" }), { today: TODAY });
  const grace = scorePost(job({ closeDate: "2026-08-22" }), { today: TODAY });
  const open = scorePost(job({ closeDate: "2026-01-01", openUntilFilled: true }), { today: TODAY });
  assert.equal(expired.status, "quarantine");
  assert.ok(expired.reasons.some((reason) => reason.code === "expired_posting"));
  assert.ok(!grace.reasons.some((reason) => reason.code === "expired_posting"));
  assert.notEqual(open.status, "quarantine");
});

test("a strong academic title on a search page is routed to review", () => {
  const quality = scorePost(job({ url: "https://jobs.example.edu/search" }), { today: TODAY });
  assert.equal(quality.status, "review");
  assert.ok(quality.reasons.some((reason) => reason.code === "search_page_url"));
});

test("CUNY DirectEmployers job routes are recognized as direct postings", () => {
  const quality = scorePost(job({
    url: "https://cuny.jobs/new-york-ny/assistant-professor/6052470F8928436B9A3681F255F3B7AF/job",
  }), { today: TODAY });
  assert.equal(quality.linkType, "direct");
  assert.ok(!quality.reasons.some((reason) => reason.code === "search_page_url"));
});

test("generic faculty page chrome is quarantined only on search pages", () => {
  const chrome = scorePost(job({
    title: "Faculty & Staff Jobs",
    url: "https://www.example.edu/about/employment",
  }), { today: TODAY });
  const posting = scorePost(job({
    title: "Full-Time Faculty",
    url: "https://www.example.edu/jobs/full-time-faculty-123",
  }), { today: TODAY });
  assert.equal(chrome.status, "quarantine");
  assert.ok(chrome.reasons.some((reason) => reason.code === "resource_page_title"));
  assert.ok(!posting.reasons.some((reason) => reason.code === "resource_page_title"));
});

test("reviewed academic and inline-listing evidence clears known false warnings", () => {
  const quality = scorePost(job({
    title: "Accounting Faculty",
    url: "https://www.example.edu/employment",
    qualityEvidence: "reviewed-academic-appointment",
    qualityLinkEvidence: "verified-inline-posting",
  }), { today: TODAY });
  assert.equal(quality.academicAppointment, true);
  assert.equal(quality.linkType, "reviewed-direct");
  assert.ok(!quality.reasons.some((reason) => reason.code === "weak_academic_evidence"));
  assert.ok(!quality.reasons.some((reason) => reason.code === "search_page_url"));
});

test("reviewed faculty resources and non-faculty fellowships are quarantined", () => {
  for (const candidate of [
    job({ title: "Chemistry Faculty & Staff", url: "https://example.edu/academics/chemistry/faculty-staff", qualityEvidence: "reviewed-non-posting" }),
    job({ title: "Faculty Resource Guide", url: "https://example.edu/faculty-handbook", qualityEvidence: "reviewed-non-posting" }),
    job({ title: "Athletic Training Fellow", url: "https://example.edu/jobs/123", qualityEvidence: "reviewed-non-posting" }),
  ]) {
    const quality = scorePost(candidate, { today: TODAY });
    assert.equal(quality.status, "quarantine");
    assert.ok(quality.reasons.some((reason) => reason.code === "reviewed_non_posting"));
  }
});

test("missing optional metadata lowers completeness without quarantining", () => {
  const quality = scorePost(job({ description: "", department: "", location: "", closeDate: "" }), { today: TODAY });
  assert.equal(quality.status, "pass");
  assert.ok(quality.score < 100);
  assert.ok(quality.reasons.some((reason) => reason.code === "missing_description"));
});

test("stable IDs and deterministic samples are repeatable and stratified", () => {
  const jobs = [
    job({ url: "https://jobs.example.edu/postings/1", source: "A" }),
    job({ url: "https://jobs.example.edu/postings/2", source: "B" }),
    job({ url: "https://jobs.example.edu/postings/3", source: "A", title: "Faculty Support" }),
  ];
  const scored = scoreCatalog(jobs, { today: TODAY });
  const first = deterministicStratifiedSample(scored, { size: 3 }).map((row) => row.quality.id);
  const second = deterministicStratifiedSample(scored, { size: 3 }).map((row) => row.quality.id);
  assert.deepEqual(first, second);
  assert.equal(new Set(first).size, 3);
  assert.equal(stableJobId(jobs[0]), stableJobId({ ...jobs[0], title: "Changed title" }));
});

test("detects institution-name-as-city location placeholders (issue #120)", () => {
  assert.equal(isPlaceholderLocation("Wilson Community College, NC", "Wilson Community College"), true);
  assert.equal(isPlaceholderLocation("Harvard University, MA", "Harvard University"), true);
  assert.equal(isPlaceholderLocation("Medical College of Wisconsin, WI", "Medical College of Wisconsin"), true);
  assert.equal(isPlaceholderLocation("University of Wisconsin Eau Claire, WI", "University of Wisconsin-Eau Claire"), true);
  assert.equal(isPlaceholderLocation("Augusta University", "Augusta University"), true);
  // Real cities, including one that happens to share a word with the college name.
  assert.equal(isPlaceholderLocation("Milwaukee, WI", "Medical College of Wisconsin"), false);
  assert.equal(isPlaceholderLocation("Cambridge, MA", "Harvard University"), false);
  assert.equal(isPlaceholderLocation("Tempe, AZ", "Arizona State University"), false);
  // Institutions actually named after (and located in) a real city of the
  // same name — a looser "location's words are a subset of college's words"
  // check would wrongly flag every one of these as a placeholder.
  assert.equal(isPlaceholderLocation("Santa Clara, CA", "Santa Clara University"), false);
  assert.equal(isPlaceholderLocation("Houston, TX", "University of Houston"), false);
  assert.equal(isPlaceholderLocation("Radford, VA", "Radford University"), false);
  assert.equal(isPlaceholderLocation("Villanova, PA", "Villanova University"), false);
  // A campus name that's a real, distinct place should not be flagged.
  assert.equal(isPlaceholderLocation("Remote", "Harvard University"), false);
  assert.equal(isPlaceholderLocation("", "Harvard University"), false);
  // "Main Campus - City, ST" is a legitimate convention for a real satellite
  // campus, even when the college name itself embeds that campus suffix
  // (so the whole location string would otherwise equal `${college}, ${state}`).
  assert.equal(isPlaceholderLocation("Saint Joseph's University - Lancaster, PA", "Saint Joseph's University - Lancaster"), false);
  // Institutions without "university"/"college"/etc. in the name (SUNY
  // campuses, seminaries) are still real placeholder candidates.
  assert.equal(isPlaceholderLocation("SUNY Cortland, NY", "SUNY Cortland"), true);
  assert.equal(isPlaceholderLocation("Midwestern Baptist Theological Seminary, MO", "Midwestern Baptist Theological Seminary"), true);
});

test("scorePost flags a placeholder location as a completeness reason, distinct from missing_location", () => {
  const placeholder = scorePost(job({ location: "Wilson Community College, NC", college: "Wilson Community College" }), { today: TODAY });
  assert.ok(placeholder.reasons.some((r) => r.code === "placeholder_location"));
  assert.ok(!placeholder.reasons.some((r) => r.code === "missing_location"));

  const realLocation = scorePost(job({ location: "Milwaukee, WI", college: "Medical College of Wisconsin" }), { today: TODAY });
  assert.ok(!realLocation.reasons.some((r) => r.code === "placeholder_location"));

  const missing = scorePost(job({ location: "", state: "", college: "Example University" }), { today: TODAY });
  assert.ok(missing.reasons.some((r) => r.code === "missing_location"));
  assert.ok(!missing.reasons.some((r) => r.code === "placeholder_location"));
});

// --- Issue #129: confirmed non-job examples (resource/directory/marketing
// pages, test records, staff roles with weak-evidence title matches) ---

test("faculty directory, biography, leadership, overview, and video pages are quarantined (issue #129)", () => {
  for (const title of [
    "Academic Leadership & Faculty",
    "Faculty Biographies",
    "Faculty Directory",
    "Faculty Experience",
    "Faculty Overview",
    "Faculty Videos",
  ]) {
    const quality = scorePost(job({ title, url: "https://example.edu/about/faculty" }), { today: TODAY });
    assert.equal(quality.status, "quarantine", title);
    assert.ok(quality.reasons.some((reason) => reason.code === "resource_page_title"), title);
  }
});

test("a page naming faculty applicants as an audience, not a role, is quarantined (issue #129)", () => {
  const quality = scorePost(job({
    title: "Information for Santa Fe Faculty Applicants",
    url: "https://www.sjc.edu/santa-fe/offices-services/human-resources/faculty-applicants",
  }), { today: TODAY });
  assert.equal(quality.status, "quarantine");
  assert.ok(quality.reasons.some((reason) => reason.code === "resource_page_title"));
});

test("a legitimate 'Applicant Pool' posting title is not caught by the applicant-information-page check (issue #129)", () => {
  const quality = scorePost(job({
    title: "Adjunct Faculty - Communication Studies Applicant Pool",
    description: "Teach communication studies courses on a part-time basis; applications remain on file for future openings.",
  }), { today: TODAY });
  assert.ok(!quality.reasons.some((reason) => reason.code === "resource_page_title"));
});

test("campus-visit marketing copy that mentions faculty in passing is quarantined (issue #129)", () => {
  const quality = scorePost(job({
    title: "Visit — Explore campus, meet faculty, and see student life",
    url: "https://www.sebts.edu/admissions/visit",
  }), { today: TODAY });
  assert.equal(quality.status, "quarantine");
  assert.ok(quality.reasons.some((reason) => reason.code === "resource_page_title"));
});

test("explicit test/do-not-apply records are quarantined and removed by the publishing gate (issue #129)", () => {
  const quality = scorePost(job({
    title: "New Test for Faculty — Do NOT Apply",
    url: "https://centrecollege.wd501.myworkdayjobs.com/CentreF/job/Danville-Kentucky/New-Test-for-Faculty---Do-NOT-Apply_JR100243",
  }), { today: TODAY });
  assert.equal(quality.status, "quarantine");
  assert.ok(quality.reasons.some((reason) => reason.code === "test_or_placeholder_posting"));
  assert.equal(confirmedNonFacultyReason(job({
    title: "New Test for Faculty — Do NOT Apply",
    url: "https://centrecollege.wd501.myworkdayjobs.com/CentreF/job/Danville-Kentucky/New-Test-for-Faculty---Do-NOT-Apply_JR100243",
  }), { today: TODAY }), "test_or_placeholder_posting");
});

test("'assistant to the Dean' is an incidental reporting relationship, not a dean appointment (issue #129)", () => {
  const quality = scorePost(job({
    title: "Office Manager and Executive Assistant to the Dean",
    url: "https://howardcc.peopleadmin.com/postings/6159",
  }), { today: TODAY });
  assert.equal(quality.status, "quarantine");
  assert.ok(quality.reasons.some((reason) => reason.code === "administrative_staff_title"));
});

test("a real Dean appointment is still recognized as a strong academic title (issue #129 regression guard)", () => {
  const quality = scorePost(job({ title: "Dean of the College of Business", description: "" }), { today: TODAY });
  assert.ok(!quality.reasons.some((reason) => reason.code === "administrative_staff_title"));
  assert.equal(quality.academicAppointment, true);
});

test("academic advising staff roles without an appointment title are quarantined (issue #129)", () => {
  const quality = scorePost(job({
    title: "Academic Advisor 3",
    url: "https://careers.uh.edu/jobs/academic-advisor-3-undergraduate-business-programs-houston-texas-united-states-6abac11b-ddb9-4708-8ada-489a04ba450a",
  }), { today: TODAY });
  assert.equal(quality.status, "quarantine");
  assert.ok(quality.reasons.some((reason) => reason.code === "student_service_title"));
});

test("positionType 'Other' is treated as absence of evidence, not positive evidence (issue #129)", () => {
  const other = scorePost(job({ title: "Assessment Support", description: "", positionType: "Other" }), { today: TODAY });
  assert.ok(other.reasons.some((reason) => reason.code === "weak_academic_evidence"));
  assert.notEqual(other.status, "pass");

  const missing = scorePost(job({ title: "Assessment Support", description: "", positionType: "" }), { today: TODAY });
  assert.ok(missing.reasons.some((reason) => reason.code === "weak_academic_evidence"));

  const real = scorePost(job({ title: "Assessment Support", description: "", positionType: "Lecturer" }), { today: TODAY });
  assert.ok(!real.reasons.some((reason) => reason.code === "weak_academic_evidence"));
});

test("tenureTrack: false is a real classification, not absent evidence (clean() falsy-boolean regression)", () => {
  // `clean(value)` is `String(value || '').trim()` -- `false || ''`
  // short-circuits to '' because `false` is itself falsy, so
  // `clean(false)` and `clean(null)` were indistinguishable. A job with an
  // explicit `tenureTrack: false` (non-tenure-track) classification must not
  // be treated the same as one with no tenureTrack data at all.
  const nonTenureTrack = scorePost(job({ title: "Assessment Support", description: "", tenureTrack: false }), { today: TODAY });
  assert.ok(!nonTenureTrack.reasons.some((reason) => reason.code === "weak_academic_evidence"));

  const tenureTrack = scorePost(job({ title: "Assessment Support", description: "", tenureTrack: true }), { today: TODAY });
  assert.ok(!tenureTrack.reasons.some((reason) => reason.code === "weak_academic_evidence"));

  const missing = scorePost(job({ title: "Assessment Support", description: "", tenureTrack: null }), { today: TODAY });
  assert.ok(missing.reasons.some((reason) => reason.code === "weak_academic_evidence"));
});

// --- Issue #130: completeness/badges must reject malformed metadata ---

test("a malformed department (scraper noise) does not earn completeness credit (issue #130)", () => {
  for (const department of [
    "s. Come work alongside a committed group of faculty and staff to provide transformational",
    "Biology Region: Finger Lakes Open until filled",
    "222720 - UGE Some Program",
    "Biology (Adjunct) Search",
  ]) {
    const quality = scorePost(job({ department }), { today: TODAY });
    assert.ok(quality.reasons.some((reason) => reason.code === "missing_department"), department);
  }
});

test("a valid department still earns completeness credit (issue #130 regression guard)", () => {
  const quality = scorePost(job({ department: "Department of Chemistry" }), { today: TODAY });
  assert.ok(!quality.reasons.some((reason) => reason.code === "missing_department"));
});

test("a bot-challenge description is treated as missing and flagged distinctly, not accepted as real content (issue #130)", () => {
  const quality = scorePost(job({ description: "Performing security verification. This may take a few seconds." }), { today: TODAY });
  assert.ok(quality.reasons.some((reason) => reason.code === "bot_challenge_description"));
  assert.ok(!quality.reasons.some((reason) => reason.code === "missing_description"));
  assert.ok(!quality.reasons.some((reason) => reason.code === "thin_description"));
});

// --- Issue #131: freshness must not give decade-old postings full credit
// without an evergreen/pool signal ---

test("an old individual vacancy with no evergreen signal loses freshness confidence (issue #131, UNC Nutrigenomics example)", () => {
  const quality = scorePost(job({
    title: "Assistant Professor of Nutrigenomics",
    college: "University of North Carolina",
    url: "https://unc.peopleadmin.com/postings/318489",
    datePosted: "2016-05-16",
    closeDate: "",
    openUntilFilled: true,
  }), { today: TODAY });
  assert.ok(quality.reasons.some((reason) => reason.code === "stale_posting_no_evergreen_signal"));
  assert.notEqual(quality.status, "pass");
  assert.equal(quality.evergreenPool, false);
});

test("an explicit evergreen/applicant-pool posting keeps full freshness credit despite its age (issue #131, Villanova example)", () => {
  const quality = scorePost(job({
    title: "Adjunct Faculty Applicant Pool - Communication",
    college: "Villanova University",
    url: "https://jobs.villanova.edu/postings/33397",
    description: "The university accepts applications for this pool at any time and will contact qualified candidates when a teaching need arises.",
    datePosted: "2012-01-01",
    closeDate: "",
    openUntilFilled: true,
  }), { today: TODAY });
  assert.ok(!quality.reasons.some((reason) => reason.code === "stale_posting_no_evergreen_signal"));
  assert.ok(!quality.reasons.some((reason) => reason.code === "aging_posting_no_evergreen_signal"));
  assert.equal(quality.evergreenPool, true);
  assert.equal(quality.status, "pass");
});

test("'Open Until Filled' alone is not treated as an evergreen signal (issue #131)", () => {
  const quality = scorePost(job({
    datePosted: "2018-01-01",
    closeDate: "",
    openUntilFilled: true,
  }), { today: TODAY });
  assert.equal(quality.evergreenPool, false);
  assert.ok(quality.reasons.some((reason) => reason.code === "stale_posting_no_evergreen_signal"));
});

test("freshness age penalties are graduated and a recent posting is unaffected (issue #131)", () => {
  const recent = scorePost(job({ datePosted: "2026-08-01" }), { today: TODAY });
  assert.ok(!recent.reasons.some((reason) => reason.dimension === "freshness" && reason.code.includes("evergreen")));

  const aging = scorePost(job({ datePosted: "2025-01-01", closeDate: "", openUntilFilled: true }), { today: TODAY });
  assert.ok(aging.reasons.some((reason) => reason.code === "aging_posting_no_evergreen_signal" && reason.severity === "info"));

  const stale = scorePost(job({ datePosted: "2023-01-01", closeDate: "", openUntilFilled: true }), { today: TODAY });
  assert.ok(stale.reasons.some((reason) => reason.code === "stale_posting_no_evergreen_signal" && reason.severity === "warning"));
});

// --- Issue #149: explicit adjunct-appointment titles must not be caught by
// the directory/biography/overview/video resource-keyword heuristic ---

test("genuine adjunct Video/Overview appointments are not caught by the resource-keyword heuristic (issue #149)", () => {
  for (const title of [
    "Adjunct Faculty - Video Production I",
    "Adjunct Faculty – Computer Graphics – Digital Video",
    "Adjunct Faculty, Film and Video",
    "Applicant Pool for Adjunct Faculty, Broadcasting/Video Production",
    "Applicant Pool for Adjunct Faculty, Lab Assistant, Broadcasting/Video Production",
    "Adjunct Faculty, Online Course (SPAC 500- Overview of the Space Ecosystem, College of Aviation, Worldwide Campus)",
  ]) {
    const quality = scorePost(job({ title }), { today: TODAY });
    assert.notEqual(quality.status, "quarantine", title);
    assert.ok(!quality.reasons.some((reason) => reason.code === "resource_page_title"), title);
    assert.equal(confirmedNonFacultyReason(job({ title }), { today: TODAY }), null, title);
  }
});

test("actual faculty directory/overview/video resource pages are still quarantined (issue #149 regression guard)", () => {
  for (const title of ["Faculty Overview", "Faculty Videos", "Faculty Directory", "Academic Overview"]) {
    assert.equal(confirmedNonFacultyReason(job({ title }), { today: TODAY }), "resource_page_title", title);
  }
});

// --- Issue #150: DOL/OFLC "Notice of Filing" compliance notices for
// already-filled positions must not pass as open jobs ---

test("a title containing 'Notice of Filing' is a confirmed non-posting (issue #150)", () => {
  const quality = scorePost(job({
    title: "Associate Professor Notice of Filing",
    college: "UW-Madison",
    description: "NOTICE OF FILING - Please do not apply to this position as it has been filled. This posting is mandatory to meet a United States Department of Labor requirement.",
  }), { today: TODAY });
  assert.equal(quality.status, "quarantine");
  assert.ok(quality.reasons.some((reason) => reason.code === "filled_compliance_notice"));
  assert.equal(confirmedNonFacultyReason(job({ title: "Associate Professor Notice of Filing" }), { today: TODAY }), "filled_compliance_notice");
});

test("a title that omits 'Notice of Filing' is still caught from decisive description language (issue #150)", () => {
  const quality = scorePost(job({
    title: "Music and Theatre Arts: Assistant Professor as Orchestra Director",
    college: "University of Wisconsin-Eau Claire",
    description: "NOTICE OF FILING - Please do not apply to this position as it has been filled. This posting is mandatory to meet a United States Department of Labor requirement. See the job posting for more details.",
  }), { today: TODAY });
  assert.equal(quality.status, "quarantine");
  assert.ok(quality.reasons.some((reason) => reason.code === "filled_compliance_notice"));
  assert.equal(confirmedNonFacultyReason(job({
    title: "Music and Theatre Arts: Assistant Professor as Orchestra Director",
    description: "NOTICE OF FILING - Please do not apply to this position as it has been filled. This posting is mandatory to meet a United States Department of Labor requirement.",
  }), { today: TODAY }), "filled_compliance_notice");
});

test("ordinary 'until the position is filled' review language is not mistaken for a filled-compliance notice (issue #150 regression guard)", () => {
  const quality = scorePost(job({
    description: "Review of applications will begin immediately and continue until the position is filled. Salary is set as mandated by a U.S. Department of Labor prevailing wage determination.",
  }), { today: TODAY });
  assert.notEqual(quality.status, "quarantine");
  assert.ok(!quality.reasons.some((reason) => reason.code === "filled_compliance_notice"));
});

// --- Issue #153: "Faculty & Staff" / "Faculty and Staff" / "Faculty + Staff"
// resource/roster pages must not pass as open jobs, while genuine postings
// that merely mention the phrase remain eligible ---

test("faculty/staff directories, portals, handbooks, benefits, and departmental rosters are quarantined (issue #153)", () => {
  for (const title of [
    "Faculty & Staff Email",
    "Faculty & Staff Benefits",
    "Faculty & Staff Handbook",
    "Faculty and Staff Intranet",
    "Faculty and Staff-Student Non-Fraternization Policy",
    "Biology Faculty and Staff",
    "Faculty and Staff Profiles",
    "Faculty and Staff Parking",
    "Directory (Faculty & Staff)",
    "Faculty + Staff Directory",
    "AFAM Faculty and Staff",
  ]) {
    assert.equal(confirmedNonFacultyReason(job({ title }), { today: TODAY }), "resource_page_title", title);
  }
});

test("a genuine posting that merely mentions 'faculty and staff' in passing remains eligible (issue #153)", () => {
  for (const title of [
    "Faculty & Staff Employment",
    "Faculty + Staff Open Positions",
    "Faculty and Staff Dining Room Attendant (Casual Position)",
    "Faculty and Staff Employment Opportunities",
    "Faculty and Staff Fitness Instructor Pool – Spring, Summer and Fall 2026: Aquatics",
  ]) {
    assert.notEqual(confirmedNonFacultyReason(job({ title }), { today: TODAY }), "resource_page_title", title);
  }
});

test("human labels produce a precision summary and ignore unfinished labels", () => {
  assert.deepEqual(summarizeHumanLabels([
    { label: "valid" }, { label: "invalid" }, { label: "valid" }, { label: null },
  ]), { reviewed: 3, valid: 2, invalid: 1, precisionPct: 66.67 });
});
