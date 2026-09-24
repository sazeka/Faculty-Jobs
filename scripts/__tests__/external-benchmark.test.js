import assert from "node:assert/strict";
import test from "node:test";
import { compareEconJobMarket, titleMatchScore } from "../lib/external-benchmark.js";

const us = [{ country_code: "US" }];
const professor = [{ name: "Assistant Professor" }];

test("title matching tolerates punctuation and added institutional detail", () => {
  assert.equal(
    titleMatchScore(
      "Assistant Professor in Environmental Social Sciences",
      "Assistant Professor in Environmental Social Sciences, Stanford Doerr School of Sustainability"
    ).score,
    1
  );
});

test("builds a date-aligned, deduplicated external benchmark", () => {
  const ads = [
    {
      name: "University of California, Berkeley",
      adtitle: "Assistant Professor - Finance",
      adtext: "This is a tenure-track faculty position.",
      startdate: "2026-09-01",
      deadline_date: "2026-11-01",
      locations: us,
      position_types: professor,
    },
    {
      name: "University of California, Berkeley",
      adtitle: "Assistant Professor - Finance",
      adtext: "Duplicate ad.",
      startdate: "2026-09-01",
      deadline_date: "2026-11-01",
      locations: us,
      position_types: professor,
    },
    {
      name: "University of Wisconsin, Madison",
      adtitle: "Assistant Professor of Economics",
      adtext: "Tenure track appointment.",
      startdate: "2026-09-10",
      deadline_date: "2026-11-01",
      locations: us,
      position_types: professor,
    },
    {
      name: "Expired University",
      adtitle: "Assistant Professor",
      startdate: "2026-01-01",
      deadline_date: "2026-08-01",
      locations: us,
      position_types: professor,
    },
  ];
  const jobs = [
    { college: "UC Berkeley", title: "Assistant Professor, Finance", tenureTrack: true },
    { college: "UW-Madison", title: "Assistant Professor of Economics", tenureTrack: true },
  ];

  const report = compareEconJobMarket({ ads, jobs, snapshotDate: "2026-09-17", includeDetails: true });
  assert.equal(report.counts.eligibleAds, 2);
  assert.equal(report.counts.matchedAds, 2);
  assert.equal(report.rates.overallCoveragePercent, 100);
  assert.equal(report.rates.tenureAgreementPercent, 100);
  assert.equal(report.matches[0].institution === "UC Berkeley" || report.matches[1].institution === "UC Berkeley", true);
});

test("matches the comma spelling of University of California, San Diego", () => {
  const ads = [{
    name: "University of California, San Diego",
    adtitle: "Assistant/Associate/Full Professor of Economics",
    adtext: "Tenure-track position.",
    startdate: "2026-09-01",
    deadline_date: "2026-11-01",
    locations: us,
    position_types: professor,
    url: "https://econjobmarket.org/positions/12696",
  }];
  const jobs = [{
    college: "University of California-San Diego",
    title: "Assistant/Associate/Full Professor of Economics",
    tenureTrack: true,
    url: "https://apol-recruit.ucsd.edu/JPF04622",
  }];

  const report = compareEconJobMarket({ ads, jobs, snapshotDate: "2026-09-23", includeDetails: true });
  assert.equal(report.counts.matchedAds, 1);
  assert.equal(report.matches[0].benchmarkUrl, "https://econjobmarket.org/positions/12696");
  assert.equal(report.matches[0].atlasUrl, "https://apol-recruit.ucsd.edu/JPF04622");
});
