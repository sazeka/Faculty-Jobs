import assert from "node:assert/strict";
import test from "node:test";
import {
  extractSelectMindsDescription,
  isSelectMindsJobUrl,
} from "../lib/selectminds-description.js";

test("recognizes SelectMinds and UTMB job URLs", () => {
  assert.equal(isSelectMindsJobUrl("https://uthscsa.referrals.selectminds.com/faculty/jobs/assistant-professor-1951"), true);
  assert.equal(isSelectMindsJobUrl("https://applyjobs.utmb.edu/jobs/assistant-professor-33753"), true);
  assert.equal(isSelectMindsJobUrl("https://example.edu/jobs/assistant-professor"), false);
});

test("extracts the posting body without surrounding page chrome", () => {
  const html = `
    <nav>Site navigation</nav>
    <div class="job_description">
      <p>This position is a 12-month, tenure-track appointment.</p>
      <p>Teach &amp; mentor students.&nbsp;</p>
    </div>
    <footer>Track your opportunities.</footer>`;
  assert.equal(
    extractSelectMindsDescription(html),
    "This position is a 12-month, tenure-track appointment.\nTeach & mentor students."
  );
});
