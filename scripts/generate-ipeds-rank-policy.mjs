#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { parseCsv } from "./lib/ipeds.js";
import { classifyTenureTrack } from "./lib/weekly-tenure-stats.js";

const salariesPath = process.argv[2];
const outputPath = process.argv[3] || "data/ipeds-rank-tenure-policy.json";

if (!salariesPath) {
  console.error("Usage: node scripts/generate-ipeds-rank-policy.mjs <S2024_SIS.csv> [output.json]");
  process.exit(1);
}

const rankColumns = [
  ["professor", "SISPROF"],
  ["associate professor", "SISASCP"],
  ["assistant professor", "SISASTP"],
  ["instructor", "SISINST"],
  ["lecturer", "SISLECT"],
];

// These exact live titles are intentionally left unknown by narrower,
// institution-specific policy research. Aggregate IPEDS rank totals cannot
// resolve the title-level ambiguity documented by those policies.
const protectedUnknownKeys = new Set([
  "Fort Hays Tech North Central\u0000Nursing Instructor",
  "Bryant University\u0000Assistant Professor, Global Supply Chain Management",
  "Galveston College\u0000Program Director/Instructor-Law Enforcement",
  "North Carolina A&T State University\u0000News and Record-Janice Byrant Howroyd Endowed Professor",
]);

function offeredRanks(title) {
  let remaining = String(title || "").toLowerCase();
  const ranks = new Set();
  const qualifiedProfessorRank =
    /\b(?:(?:assistant|associate|full)\s*(?:(?:\/|,|&|-)|\bor\b|\band\b)\s*)*(?:assistant|associate|full)\s+professors?\b/g;

  remaining = remaining.replace(qualifiedProfessorRank, (phrase) => {
    if (/\bassistant\b/.test(phrase)) ranks.add("assistant professor");
    if (/\bassociate\b/.test(phrase)) ranks.add("associate professor");
    if (/\bfull\b/.test(phrase)) ranks.add("professor");
    return " ";
  });
  if (/\bprofessors?\b/.test(remaining)) ranks.add("professor");
  if (/\binstructors?\b/.test(remaining)) ranks.add("instructor");
  if (/\blecturers?\b/.test(remaining)) ranks.add("lecturer");
  return [...ranks];
}

const prior = JSON.parse(fs.readFileSync(outputPath, "utf8"));
const priorKeys = new Set(
  (prior.entries || []).map((entry) => `${entry.college}\u0000${entry.title}`)
);
const jobs = JSON.parse(fs.readFileSync("public/jobs.json", "utf8")).jobs;
const institutions = JSON.parse(fs.readFileSync("data/institutions-master.json", "utf8")).institutions;
const unitIdByCollege = new Map(institutions.map((institution) => [institution.name, String(institution.unitid)]));

const totalsByUnitId = new Map();
for (const row of parseCsv(fs.readFileSync(salariesPath, "utf8"))) {
  if (row.FACSTAT !== "30" && row.FACSTAT !== "40") continue;
  const totals = totalsByUnitId.get(row.UNITID) || {};
  for (const [rank, column] of rankColumns) {
    const current = totals[rank] || { tenureTrack: 0, nonTenureTrack: 0 };
    current[row.FACSTAT === "30" ? "tenureTrack" : "nonTenureTrack"] += Number(row[column] || 0);
    totals[rank] = current;
  }
  totalsByUnitId.set(row.UNITID, totals);
}

const entriesByKey = new Map();
for (const job of jobs) {
  const key = `${job.college}\u0000${job.title}`;
  if (protectedUnknownKeys.has(key)) continue;
  if (!priorKeys.has(key) && classifyTenureTrack(job) !== null) continue;
  if (/\bopen rank\b|\ball ranks?\b|\brank (?:doq|commensurate|depending)\b/i.test(job.title || "")) continue;

  const unitId = unitIdByCollege.get(job.college);
  const totals = totalsByUnitId.get(unitId);
  const ranks = offeredRanks(job.title);
  if (!unitId || !totals || ranks.length === 0) continue;

  const evidence = ranks.map((rank) => ({ rank, ...totals[rank] })).filter((rank) => rank.tenureTrack !== undefined);
  if (evidence.length !== ranks.length) continue;
  const tenureTrack = evidence.every((rank) => rank.tenureTrack > 0 && rank.nonTenureTrack === 0);
  const nonTenureTrack = evidence.every((rank) => rank.nonTenureTrack > 0 && rank.tenureTrack === 0);
  if (!tenureTrack && !nonTenureTrack) continue;

  entriesByKey.set(key, {
    college: job.college,
    title: job.title,
    value: tenureTrack,
    unitId: Number(unitId),
    ranks: evidence,
  });
}

const entries = [...entriesByKey.values()].sort(
  (a, b) => a.college.localeCompare(b.college) || a.title.localeCompare(b.title)
);
const result = {
  _comment:
    "Exact live-listing rules derived from institutions' certified 2024-25 IPEDS Salaries component. Entries are limited to current titles whose every offered academic rank has staff exclusively on one side of the institution's tenure system.",
  source: "https://nces.ed.gov/ipeds/complete-data-files/S2024_SIS.zip",
  verifiedAt: "2026-09-21",
  entries,
};

fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(`Wrote ${entries.length} exact title rules to ${path.resolve(outputPath)}`);
