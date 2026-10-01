#!/usr/bin/env node
// One-off migration for a bug related to, but distinct from, issue #137:
// #137 covered locations that were a bare credential/rank fragment with no
// real city at all ("MD, DO", "Instructor I, II"). This batch's records DO
// contain a real, correct city/state, but a job-label or employment-status
// fragment was glued onto the front with no separator (HACC's "MATH Faculty
// Exempt Gettysburg, PA", University of Toledo's "Full Professor Health
// Science Campus College Toledo, OH"). server.js's new
// recoverLabelPrefixedLocation() strips a small set of unambiguous HR/ATS
// status markers ("Exempt", "Non exempt", "Health Science Campus College",
// "Full-Time"/"Part-Time") and recovers the real trailing city for most of
// these automatically -- and is now wired into the live scrape pipeline's
// normalizeLocationByCollege() so future scrapes self-heal the same way.
//
// A handful of records use a bare "Faculty" marker instead, which is too
// ambiguous to strip by rule (it precedes both real cities, like Kenyon's
// "... Faculty Gambier, OH", and non-place fragments, like UWF's "...
// Faculty Usha Kundu, MD" -- "Usha Kundu, M.D." is a campus building name,
// not a city, and "MD" is being misread as Maryland the same way "MD, DO"
// was in #137). One more record (KCTCS's "Nursing Instructor - LPN
// Carrollton, KY") has no marker at all. These 10 are hand-verified against
// each record's own URL slug below, the same way #137's script resolved the
// cases it couldn't derive by rule.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isPlausibleCityStateLocation, recoverLabelPrefixedLocation } from "../server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DRY_RUN = process.argv.includes("--dry-run");
const TARGETS = ["public/jobs.json", "docs/jobs.json"];
const REPORT_PATH = path.join(ROOT, "generated", "label-prefixed-location-fix-report.json");

// Hand-verified against each record's own URL slug (Kenyon and KCTCS confirm
// the city directly; UWF's slug is "...-pensacola-main-campus-florida-...").
const HAND_VERIFIED_FIXES_BY_URL = new Map([
  ["https://careers.uwf.edu/jobs/assistant-professor-108250-pensacola-main-campus-florida-united-states-52ddf55e-f80a-4b8a-b50e-fbb8d92e66e6", "Pensacola, FL"],
  ["https://careers.uwf.edu/jobs/assistant-professor-of-clinical-practice-in-nursing-position-127850-127920-pensacola-main-campus-florida-united-states", "Pensacola, FL"],
  ["https://careers.uwf.edu/jobs/fnp-program-director-and-assistant-professor-of-clinical-practice-128180-pensacola-main-campus-florida-united-states", "Pensacola, FL"],
  ["https://careers.uwf.edu/jobs/instructor-130340-pensacola-main-campus-florida-united-states", "Pensacola, FL"],
  ["https://careers.uwf.edu/jobs/lecturer-in-nursing-124250-pensacola-main-campus-florida-united-states", "Pensacola, FL"],
  ["https://careers.kenyon.edu/jobs/assistant-professor-of-biology-molecular-biology-tenure-track-gambier-oh-ohio-united-states", "Gambier, OH"],
  ["https://careers.kenyon.edu/jobs/assistant-professor-of-environmental-studies-and-biology-tenure-track-gambier-oh-ohio-united-states", "Gambier, OH"],
  ["https://careers.kenyon.edu/jobs/assistant-professor-of-political-science-environmental-studies-gambier-oh-ohio-united-states", "Gambier, OH"],
  ["https://careers.kenyon.edu/jobs/assistant-professor-of-political-science-tenure-track-gambier-oh-ohio-united-states", "Gambier, OH"],
  ["https://careers.kctcs.edu/jobs/nursing-instructor-lpn-carrollton-ky-kentucky-united-states-louisville", "Carrollton, KY"],
]);

const CITY_STATE_SHAPE = /^[A-Za-z .'-]{2,60},\s*[A-Z]{2}$/;

function main() {
  const sourcePath = path.join(ROOT, TARGETS[0]);
  const source = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  let jobs = source.jobs;

  let ruleRecoveredCount = 0;
  let handVerifiedCount = 0;
  const ruleRecoveredSamples = [];
  const handVerifiedSamples = [];
  const stillUnresolved = [];

  jobs = jobs.map((job) => {
    if (!job.location || !CITY_STATE_SHAPE.test(job.location) || isPlausibleCityStateLocation(job.location)) {
      return job;
    }

    const ruleRecovered = recoverLabelPrefixedLocation(job.location);
    if (ruleRecovered) {
      ruleRecoveredCount += 1;
      ruleRecoveredSamples.push({ url: job.url, before: job.location, after: ruleRecovered });
      return { ...job, location: ruleRecovered };
    }

    const handFix = HAND_VERIFIED_FIXES_BY_URL.get(job.url);
    if (handFix) {
      handVerifiedCount += 1;
      handVerifiedSamples.push({ url: job.url, before: job.location, after: handFix });
      return { ...job, location: handFix };
    }

    stillUnresolved.push({ url: job.url, location: job.location, college: job.college });
    return job;
  });

  const report = {
    generatedAt: new Date().toISOString(),
    dryRun: DRY_RUN,
    ruleRecoveredCount,
    ruleRecoveredSamples,
    handVerifiedCount,
    handVerifiedSamples,
    stillUnresolvedCount: stillUnresolved.length,
    stillUnresolved,
  };

  console.log(JSON.stringify(report, null, 2));

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\n(Full report written to ${REPORT_PATH}${DRY_RUN ? " -- dry run, jobs.json files NOT modified" : ""})`);

  if (!DRY_RUN) {
    const output = { ...source, jobs };
    for (const relative of TARGETS) {
      fs.writeFileSync(path.join(ROOT, relative), `${JSON.stringify(output, null, 2)}\n`);
    }
  }
}

main();
