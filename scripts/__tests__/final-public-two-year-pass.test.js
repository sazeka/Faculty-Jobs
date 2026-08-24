import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { extractSwtxEmploymentJobsFromHtml } from "../../server.js";

const source = fs.readFileSync(new URL("../../server.js", import.meta.url), "utf8");

test("final public two-year pass uses institution-scoped official routes", () => {
  assert.match(source, /Grossmont College[\s\S]{0,180}type: "workday"[\s\S]{0,220}locations=ca95798f91ff0127dc8b3f75671b1cae/);
  assert.match(source, /Ohlone College[\s\S]{0,160}type: "schooljobs"[\s\S]{0,180}schooljobs\.com\/careers\/ohlone/);
  assert.match(source, /Georgia State University-Perimeter College[\s\S]{0,260}query_organizational_tier_2_id%5B%5D=429/);
  assert.match(source, /Luzerne County Community College.*luzerne\.edu\/about\/jobs\/jobs\.jsp/);
  assert.match(source, /Southwest Texas College.*type: "swtx-employment".*swtxc\.edu\/about\/employment-opportunities/);
});

test("Southwest Texas faculty tables pair posting links with sibling titles", () => {
  const html = `
    <table><caption>Faculty Full-Time Vacancies</caption><tbody>
      <tr><td><a href="../../documents/hr/job_postings/nursing.pdf">252</a></td><td>AAS Nursing Faculty</td><td>Open</td><td>Uvalde</td></tr>
      <tr><td><a href="../../documents/hr/job_postings/nursing.pdf">252 duplicate</a></td><td>AAS Nursing Faculty</td><td>Open</td><td>Uvalde</td></tr>
      <tr><td><a href="/part-time.pdf">253</a></td><td>Part-Time Biology Instructor</td><td>Open</td><td>Eagle Pass</td></tr>
      <tr><td><a href="/nursing-faculty-part-time.pdf">254</a></td><td>Nursing Faculty</td><td>Open</td><td>Uvalde</td></tr>
    </tbody></table>
    <table><caption>Staff Vacancies</caption><tbody>
      <tr><td><a href="/staff.pdf">300</a></td><td>Instructor Support Specialist</td><td>Open</td><td>Uvalde</td></tr>
    </tbody></table>`;
  const jobs = extractSwtxEmploymentJobsFromHtml(html, "https://www.swtxc.edu/about/employment-opportunities/");
  assert.deepEqual(jobs.map(({ title, url, location }) => ({ title, url, location })), [{
    title: "AAS Nursing Faculty",
    url: "https://www.swtxc.edu/documents/hr/job_postings/nursing.pdf",
    location: "Uvalde",
  }]);
});

test("TX dispatcher uses the dedicated Southwest Texas extractor", () => {
  const dispatcher = source.match(/async function scrapeTxAll[\s\S]*?async function scrapeFlAll/);
  assert.ok(dispatcher);
  assert.match(dispatcher[0], /type === "swtx-employment"[\s\S]*scrapeSwtxEmploymentAs/);
});

test("unscoped California district boards remain excluded", () => {
  assert.doesNotMatch(source, /Los Angeles City College.*laccd/);
  assert.doesNotMatch(source, /San Bernardino Community College District.*schooljobs\.com\/careers\/sbccd/);
});
