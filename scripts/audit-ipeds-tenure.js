#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyTenureTrack } from "./lib/weekly-tenure-stats.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jobs = JSON.parse(fs.readFileSync(path.join(root, "public/jobs.json"), "utf8")).jobs;
const institutions = JSON.parse(
  fs.readFileSync(path.join(root, "data/institutions-master.json"), "utf8")
).institutions;

const unknownCounts = new Map();
for (const job of jobs) {
  if (classifyTenureTrack(job) !== null) continue;
  unknownCounts.set(job.college, (unknownCounts.get(job.college) || 0) + 1);
}

const byName = new Map(institutions.map((institution) => [institution.name, institution]));
const candidates = [...unknownCounts]
  .map(([college, unknown]) => ({ college, unknown, unitid: byName.get(college)?.unitid }))
  .filter((entry) => entry.unitid)
  .sort((a, b) => b.unknown - a.unknown);

const max = Math.max(1, Number(process.argv.find((arg) => arg.startsWith("--max="))?.split("=")[1] || 300));
const offset = Math.max(0, Number(process.argv.find((arg) => arg.startsWith("--offset="))?.split("=")[1] || 0));
const concurrency = Math.min(12, Math.max(1, Number(process.argv.find((arg) => arg.startsWith("--concurrency="))?.split("=")[1] || 8)));
const selected = candidates.slice(offset, offset + max);
let next = 0;
const results = [];

function tenureResponse(html) {
  const question = "Does your institution have a tenure system?";
  const start = html.indexOf(question);
  if (start < 0) return null;
  const section = html.slice(start, start + 5000);
  const answers = [...section.matchAll(/radio-(check|uncheck)\.svg[\s\S]{0,700}?<span>(No|Yes)/g)]
    .slice(0, 2)
    .map((match) => ({ checked: match[1] === "check", answer: match[2] }));
  return answers.find((answer) => answer.checked)?.answer || null;
}

async function worker() {
  while (next < selected.length) {
    const entry = selected[next++];
    const source = `https://nces.ed.gov/ipeds/reported-data/html/${entry.unitid}?year=2024&surveyNumber=9&viewmode=print`;
    try {
      const response = await fetch(source, { signal: AbortSignal.timeout(30000) });
      const html = await response.text();
      results.push({ ...entry, tenureSystem: tenureResponse(html), source });
    } catch (error) {
      results.push({ ...entry, tenureSystem: null, source, error: error.message });
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));
results.sort((a, b) => b.unknown - a.unknown);
console.log(JSON.stringify({
  audited: results.length,
  noTenureUnknownTotal: results.filter((entry) => entry.tenureSystem === "No").reduce((sum, entry) => sum + entry.unknown, 0),
  noTenure: results.filter((entry) => entry.tenureSystem === "No"),
  unresolved: results.filter((entry) => !entry.tenureSystem),
}, null, 2));
