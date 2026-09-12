import assert from "node:assert/strict";
import test from "node:test";

import { inferDepartmentFromTitle, validateAiDepartmentEvidence } from "../lib/department-inference.js";

test("infers department from explicit 'Professor of/in X' title patterns", () => {
  assert.equal(inferDepartmentFromTitle("Assistant Professor of Chemistry"), "Chemistry");
  assert.equal(inferDepartmentFromTitle("Lecturer in Applied Mathematics"), "Applied Mathematics");
  assert.equal(
    inferDepartmentFromTitle("Postdoctoral Fellow in Computational Biology"),
    "Computational Biology"
  );
  assert.equal(
    inferDepartmentFromTitle("Assistant Professor, Political Science"),
    "Political Science"
  );
});

test("returns null from a title with no department signal", () => {
  assert.equal(inferDepartmentFromTitle("Assistant Professor"), null);
  assert.equal(inferDepartmentFromTitle("Lecturer"), null);
  assert.equal(inferDepartmentFromTitle(""), null);
  assert.equal(inferDepartmentFromTitle(null), null);
});

test("strips a leaked academic-year prefix from the captured value", () => {
  assert.equal(
    inferDepartmentFromTitle("Assistant Professor of 2026/2027: Biology"),
    "Biology"
  );
});

test("rejects candidate values that don't look like a real department name", () => {
  assert.equal(inferDepartmentFromTitle("Professor of https://example.edu"), null);
  assert.equal(inferDepartmentFromTitle("Professor of Click Here To Apply"), null);
});

test("infers department from 'Faculty of/in X' and comma-separated 'Faculty, X' titles", () => {
  assert.equal(inferDepartmentFromTitle("Adjunct Faculty in Criminology"), "Criminology");
  assert.equal(inferDepartmentFromTitle("9.5 Faculty, MATH"), "MATH");
  assert.equal(
    inferDepartmentFromTitle("Adjunct Faculty, Computer Programming and Networking Technology"),
    "Computer Programming and Networking Technology"
  );
});

test("infers department from a dash-separated 'Faculty – X' title (no comma or of/in)", () => {
  assert.equal(inferDepartmentFromTitle("Adjunct Faculty – Mechanical Engineering"), "Mechanical Engineering");
  assert.equal(inferDepartmentFromTitle("Adjunct Faculty - Dental Hygiene"), "Dental Hygiene");
});

test("strips a leaked leading article from a captured department value", () => {
  assert.equal(
    inferDepartmentFromTitle("Adjunct Faculty in the Department of Political Science and International Affairs"),
    "Department of Political Science and International Affairs"
  );
});

test("rejects a captured value with a glued street address (Fresno-area community college titles)", () => {
  // Live example: the campus address is glued directly onto the title with
  // no separator ("...in Criminology1717 S Chestnut Ave, Fresno").
  assert.equal(inferDepartmentFromTitle("Adjunct Faculty in Criminology1717 S Chestnut Ave, Fresno"), null);
});

test("rejects a captured value that's a sentence fragment, not a department name", () => {
  // Live example: a garbled title leaked "...positions are available in our
  // world-renowned clinics and labs" as if it were the department.
  assert.equal(
    inferDepartmentFromTitle(
      "Faculty Opportunities Clinical, research and leadership positions are available in our world-renowned clinics and labs."
    ),
    null
  );
});

test("rejects 'Faculty of Practice' -- a rank/classification, not a department", () => {
  assert.equal(
    inferDepartmentFromTitle(
      "Contracted Faculty of Practice (Adjunct): EdD and PhD Kinesiology Dissertation Advisors and Committee Members"
    ),
    null
  );
});

test("validateAiDepartmentEvidence accepts a department backed by a verbatim, on-topic quote", () => {
  const job = {
    title: "Assistant Professor",
    description: "Join our growing Department of Biochemistry as we expand our research mission.",
  };
  assert.equal(
    validateAiDepartmentEvidence("Department of Biochemistry", "growing Department of Biochemistry as we", job),
    "Department of Biochemistry"
  );
});

test("validateAiDepartmentEvidence rejects a quote that isn't actually in the source (hallucination guard)", () => {
  const job = { title: "Assistant Professor", description: "A generic posting with no department mentioned." };
  assert.equal(
    validateAiDepartmentEvidence("Department of Biochemistry", "Department of Biochemistry seeks applicants", job),
    null
  );
});

test("validateAiDepartmentEvidence rejects a quote present in the source but unrelated to the claimed department", () => {
  const job = {
    title: "Assistant Professor",
    description: "This position is housed within the College of Arts and Sciences.",
  };
  // The quote is real, but it doesn't actually mention "Biochemistry" at all --
  // the model appears to have invented the department despite quoting real text.
  assert.equal(
    validateAiDepartmentEvidence("Department of Biochemistry", "housed within the College of Arts and Sciences", job),
    null
  );
});

test("validateAiDepartmentEvidence rejects a bare generic noun with no qualifying name, even when grounded", () => {
  // Real-world case: Ivy Tech postings contain "...within the framework of
  // common syllabi provided by the school." -- the word "school" is real and
  // grounded, but it isn't naming any specific department.
  const job = {
    title: "Adjunct Faculty- Nursing",
    description: "Faculty must follow the framework of common syllabi provided by the school.",
  };
  assert.equal(validateAiDepartmentEvidence("School", "provided by the school", job), null);
  assert.equal(validateAiDepartmentEvidence("Department", "our department welcomes you", {
    title: "x",
    description: "our department welcomes you to the team",
  }), null);
  // A qualified form is still accepted.
  const qualified = {
    title: "x",
    description: "Join the School of Nursing faculty today.",
  };
  assert.equal(
    validateAiDepartmentEvidence("School of Nursing", "Join the School of Nursing faculty", qualified),
    "School of Nursing"
  );
});

test("validateAiDepartmentEvidence rejects the institution's own name mistaken for a department", () => {
  // Real-world case: generic mission-statement boilerplate ("Aims Community
  // College actively supports an environment that embraces the College's
  // Mission...") gives a genuine, grounded quote containing the college's
  // own name, which the model extracted as if it were the department.
  const job = {
    title: "Adjunct Faculty: Chemistry",
    college: "Aims Community College",
    description: "Aims Community College actively supports an environment that embraces the College's Mission.",
  };
  assert.equal(
    validateAiDepartmentEvidence("Aims Community College", "Aims Community College actively supports", job),
    null
  );
});

test("validateAiDepartmentEvidence rejects a shortened alias of the institution's own name", () => {
  // Real-world case: "Harper College" (the common short name) extracted as
  // the department for a job at "William Rainey Harper College", grounded
  // in generic "About Us" boilerplate -- same failure mode as the exact-name
  // case above, just not a literal string match.
  const job = {
    title: "Adjunct Faculty Credit - Physics",
    college: "William Rainey Harper College",
    description: "We are Harper College…the college in your community. The College was established by referendum in 1965.",
  };
  assert.equal(validateAiDepartmentEvidence("Harper College", "We are Harper College", job), null);
});

test("validateAiDepartmentEvidence rejects 'Human Resources' grounded in contact-info boilerplate", () => {
  // Live example (Blackburn College): "...let Human Resources know by
  // submitting your information..." is a real, grounded quote, but HR is
  // the office to notify, not the job's actual department.
  const job = {
    title: "Adjunct Faculty Positions",
    college: "Blackburn College",
    description: "Let Human Resources know by submitting your information to be considered for future openings.",
  };
  assert.equal(validateAiDepartmentEvidence("Human Resources", "Let Human Resources know", job), null);
});

test("validateAiDepartmentEvidence strips a leaked 'Unit Name' form-field label", () => {
  // Live example (Mississippi University for Women, PeopleAdmin-style
  // posting): structured fields glued together with no separator --
  // "...Position Title X Unit Name Academic Affairs Salary Grade...".
  const job = {
    title: "Dual Enrollment Instructor Applicant Pool",
    college: "Mississippi University for Women",
    description: "Position Title Dual Enrollment Instructor Applicant Pool Unit Name Academic Affairs Salary Grade Faculty",
  };
  assert.equal(
    validateAiDepartmentEvidence("Unit Name Academic Affairs", "Unit Name Academic Affairs Salary Grade", job),
    "Academic Affairs"
  );
});

test("validateAiDepartmentEvidence rejects the job's own title copied back as the department", () => {
  // Live example (Evergreen State College): the model quoted the title
  // itself back verbatim -- trivially "grounded" since job.title is part
  // of the source text the quote is checked against.
  const job = {
    title: "Geology and Earth Systems Science Faculty (Tenure Track)",
    college: "Evergreen State College",
    description: "We seek applicants for this open position. Apply by the deadline listed below.",
  };
  assert.equal(
    validateAiDepartmentEvidence(
      "Geology and Earth Systems Science Faculty (Tenure Track)",
      "Geology and Earth Systems Science Faculty (Tenure Track)",
      job
    ),
    null
  );
});

test("validateAiDepartmentEvidence rejects a null/empty department or too-short quote", () => {
  const job = { title: "Assistant Professor", description: "Department of Biochemistry seeks applicants." };
  assert.equal(validateAiDepartmentEvidence(null, "Department of Biochemistry", job), null);
  assert.equal(validateAiDepartmentEvidence("Department of Biochemistry", "Bio", job), null);
});
