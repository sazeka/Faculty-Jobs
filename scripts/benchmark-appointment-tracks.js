#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { appointmentTrackAuditCsv, buildAppointmentTrackAudit } from "./lib/appointment-track-audit.js";
import { readJobsFile } from "./lib/jobs-file.js";

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
}

const jobsPayload = readJobsFile(path.resolve(argValue("--jobs") || "public/jobs.json"));
const institutionPolicy = readJson(argValue("--policy") || "data/institution-tenure-policy.json");
const ipedsPolicy = readJson(argValue("--ipeds-policy") || "data/ipeds-rank-tenure-policy.json");
const outPath = path.resolve(argValue("--out") || "generated/appointment-track-benchmark.json");
const samplePath = path.resolve(argValue("--sample-out") || "generated/appointment-track-review-sample.csv");
const seed = argValue("--seed") || String(jobsPayload.scrapedAt || "current").slice(0, 10);
const jobs = Array.isArray(jobsPayload) ? jobsPayload : jobsPayload.jobs || [];
const report = buildAppointmentTrackAudit({ jobs, institutionPolicy, ipedsPolicy, seed });

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.mkdirSync(path.dirname(samplePath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
fs.writeFileSync(samplePath, appointmentTrackAuditCsv(report), "utf8");

const summary = { ...report, reviewSample: undefined };
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`Review sample: ${samplePath}\n`);
