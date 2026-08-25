import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseAppOneRssJobs } from "../../server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const validation = read("generated/new-york-arts-technology-colleges-validation.json");
const milestone = read("generated/new-york-arts-technology-colleges-milestone.json");
const overrides = read("data/career-url-overrides.json");
const master = read("data/institutions-master.json");
const names = [
  "St. Francis College",
  "The Cooper Union for the Advancement of Science and Art",
  "Villa Maria College",
  "Vaughn College of Aeronautics and Technology",
];

test("AppOne RSS parsing fails closed on staff, part-time, excluded, and foreign links", () => {
  const item = (title, link) => `<item><title><![CDATA[${title}]]></title><link>${link}</link><description><![CDATA[<p>Description</p>]]></description></item>`;
  const xml = `<rss><channel>${item("Assistant Professor (NY, Flushing)", "https://www.appone.com/MainInfoReq.asp?R_ID=1&amp;B_ID=44")}${item("Registrar", "https://www.appone.com/MainInfoReq.asp?R_ID=2")}${item("Instructor (Part-time)", "https://www.appone.com/MainInfoReq.asp?R_ID=3")}${item("CSTEP Workshop Instructor", "https://www.appone.com/MainInfoReq.asp?R_ID=4")}${item("Professor", "https://example.com/job/5")}</channel></rss>`;
  const jobs = parseAppOneRssJobs(xml, "Vaughn College of Aeronautics and Technology", "NY", "\\bCSTEP\\b");
  assert.deepEqual(jobs.map((job) => job.title), ["Assistant Professor"]);
  assert.equal(jobs[0].url, "https://www.appone.com/MainInfoReq.asp?R_ID=1&B_ID=44");
});

test("four New York controls retain exact source safeguards", () => {
  for (const name of names) assert.match(server, new RegExp(`campus: "${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  assert.match(server, /St\. Francis College"[\s\S]{0,260}Faculty Positions\$/);
  assert.match(server, /Cooper Union[\s\S]{0,300}Faculty-Student Senate/);
  assert.match(server, /Vaughn College[\s\S]{0,420}appone-rss[\s\S]{0,420}current students only/);
  const dispatcher = server.match(/async function scrapeNyPrivate[\s\S]*?\/\/ Paycom scraper/);
  assert.match(dispatcher?.[0] || "", /type === "appone-rss"/);
});

test("all four live controls are applied as covered", () => {
  assert.equal(validation.validatedCount, 4);
  assert.equal(validation.invalidJobCount, 0);
  assert.equal(validation.currentFacultyJobCount, 29);
  assert.equal(milestone.appliedCount, 4);
  assert.equal(milestone.newlyCoveredCount, 4);
  for (const result of validation.results) {
    assert.equal(result.healthySource, true);
    assert.ok(result.currentFacultyJobCount > 0);
    assert.equal(overrides.overrides.find((row) => row.name === result.name)?.career_url, result.url);
    assert.equal(master.institutions.find((row) => row.name === result.name)?.coverage_status, "covered");
  }
});
