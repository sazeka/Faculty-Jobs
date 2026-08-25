import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  normalizePhenomFacultyRows,
  normalizeSelectMindsFacultyRows,
} from "../../server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const overrides = JSON.parse(fs.readFileSync(path.join(ROOT, "data/career-url-overrides.json"), "utf8"));
const master = JSON.parse(fs.readFileSync(path.join(ROOT, "data/institutions-master.json"), "utf8"));
const milestone = JSON.parse(fs.readFileSync(path.join(ROOT, "generated/ut-system-health-controls-milestone.json"), "utf8"));
const validation = JSON.parse(fs.readFileSync(path.join(ROOT, "generated/ut-system-health-controls-validation.json"), "utf8"));

const expectedControls = [
  {
    name: "The University of Texas Permian Basin",
    type: "peoplesoft-hrs",
    marker: "SiteId=10",
  },
  {
    name: "The University of Texas System Office",
    type: "peoplesoft-hrs",
    marker: "SiteId=8",
  },
  {
    name: "The University of Texas Health Science Center at Houston",
    type: "phenom-faculty-category",
    marker: "/c/faculty-physicians-jobs",
  },
  {
    name: "The University of Texas Health Science Center at San Antonio",
    type: "selectminds-faculty-search",
    marker: "uthscsa.referrals.selectminds.com/faculty",
  },
  {
    name: "The University of Texas Medical Branch at Galveston",
    type: "selectminds-faculty-saved-search",
    marker: "/landing-pages/79/jobs-matching-custom-search",
  },
];

test("five unresolved UT institutions use exact official controls", () => {
  assert.equal(milestone.appliedCount, 5);
  assert.equal(milestone.newlyCoveredCount, 5);
  for (const control of expectedControls) {
    assert.match(server, new RegExp(`campus: ${JSON.stringify(control.name)}`));
    assert.match(server, new RegExp(`type: ${JSON.stringify(control.type)}`));
    assert.ok(server.includes(control.marker));
    const override = overrides.overrides.find((row) => row.name === control.name);
    const institution = master.institutions.find((row) => row.name === control.name);
    assert.equal(override?.platform_type, control.type);
    assert.equal(override?.coverage_source, "University of Texas System");
    assert.equal(institution?.coverage_status, "covered");
    assert.equal(institution?.last_discovery_status, "official_institution_control_validated");
    assert.equal(institution?.last_discovery_confidence, 1);
  }
  assert.match(server, /links\.find\(\(item\) => \/\^view all jobs\$\/i/);
});

test("live validation exercised all five production adapters", () => {
  assert.equal(validation.validatedCount, 5);
  assert.equal(validation.allControlsReturnedSafely, true);
  assert.equal(validation.controlsWithCurrentFacultyJobs, 4);
  assert.equal(validation.currentFacultyJobCount, milestone.currentFacultyJobCount);
  assert.equal(validation.results.every((result) => result.invalidJobCount === 0), true);
  assert.equal(validation.results.find((result) => result.name === "The University of Texas System Office")?.currentFacultyJobCount, 0);
});

test("SelectMinds normalization requires canonical institution-owned jobs", () => {
  const rows = [
    {
      title: "Associate Professor/Clinical",
      url: "https://uthscsa.referrals.selectminds.com/faculty/jobs/associate-professor-clinical-13182",
      category: "Faculty",
      location: "San Antonio",
    },
    {
      title: "Emergency Medicine Physician",
      url: "https://uthscsa.referrals.selectminds.com/faculty/jobs/emergency-medicine-physician-13188",
      category: "Faculty",
      location: "San Antonio",
    },
    {
      title: "Staff Accountant",
      url: "https://uthscsa.referrals.selectminds.com/faculty/jobs/staff-accountant-99999",
      category: "Staff",
    },
    {
      title: "Location-only pseudo result",
      url: "https://uthscsa.referrals.selectminds.com/faculty/jobs/13182/other-jobs-matching/location-only",
      category: "Faculty",
    },
    {
      title: "Professor on another tenant",
      url: "https://example.com/faculty/jobs/professor-123",
      category: "Faculty",
    },
  ];

  assert.deepEqual(
    normalizeSelectMindsFacultyRows(rows, {
      expectedHost: "uthscsa.referrals.selectminds.com",
      requireCategory: "Faculty",
    }).map((row) => row.title),
    ["Associate Professor/Clinical", "Emergency Medicine Physician"],
  );

  assert.deepEqual(
    normalizeSelectMindsFacultyRows(rows, {
      expectedHost: "uthscsa.referrals.selectminds.com",
      requireCategory: "Faculty",
      requireTitleEvidence: true,
    }).map((row) => row.title),
    ["Associate Professor/Clinical"],
  );
});

test("Phenom normalization keeps category and title evidence together", () => {
  const rows = [
    {
      title: "Assistant Professor, Transplant Hepatology",
      url: "https://careers.uth.tmc.edu/us/en/job/2600016E/Assistant-Professor-Transplant-Hepatology",
      category: "Faculty & Physicians",
      location: "Texas",
    },
    {
      title: "Emergency Medicine Physician",
      url: "https://careers.uth.tmc.edu/us/en/job/2600017E/Emergency-Medicine-Physician",
      category: "Faculty & Physicians",
    },
    {
      title: "Assistant Professor",
      url: "https://careers.uth.tmc.edu/us/en/job/2600018E/Assistant-Professor",
      category: "Health Care",
    },
    {
      title: "Assistant Professor",
      url: "https://outside.example/us/en/job/2600019E/Assistant-Professor",
      category: "Faculty & Physicians",
    },
  ];

  assert.deepEqual(
    normalizePhenomFacultyRows(rows, { expectedHost: "careers.uth.tmc.edu" }).map((row) => row.title),
    ["Assistant Professor, Transplant Hepatology"],
  );
});

test("Texas dispatcher reaches both health-board adapters", () => {
  const dispatcher = server.match(/async function scrapeTxAll[\s\S]*?async function scrapeFlAll/);
  assert.ok(dispatcher);
  assert.match(dispatcher[0], /selectminds-faculty-search/);
  assert.match(dispatcher[0], /selectminds-faculty-saved-search/);
  assert.match(dispatcher[0], /scrapeSelectMindsFacultyAs/);
  assert.match(dispatcher[0], /phenom-faculty-category/);
  assert.match(dispatcher[0], /scrapePhenomFacultyCategoryAs/);
});
