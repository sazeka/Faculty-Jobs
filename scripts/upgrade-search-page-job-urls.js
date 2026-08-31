#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { peopleSoftJobDetailUrl } from "./lib/peoplesoft-job-url.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TARGETS = ["public/jobs.json", "docs/jobs.json", "web-vue/public/jobs.json"];
const REPORT_PATH = path.join(ROOT, "generated", "search-page-url-upgrade-report.json");

const FSU_JOB_IDS = new Map([
  ["Assistant Professor 9 Month Salaried (School of Communication Science & Disorders)", "63409"],
  ["Assistant Professor in Counseling Psychology, 9 Month Salaried (Educational Psychology & Learning Systems - Anne's College)", "63363"],
  ["Assistant Professor in Sport Management, 9 Month Salaried (Department of Sport Management - Anne's College)", "63368"],
  ["Assistant Professor in Sport Psychology, 9 Month Salaried (Educational Psychology & Learning Systems - Anne's College)", "63365"],
  ["Assistant Professor of Violin, 9 Month Salaried - College of Music", "63386"],
  ["Assistant Professor, 9 Month Salaried - Elementary Mathematics Education School of Teacher Education - Anne Spencer Daves College of Education, Health, and Human Sciences", "63374"],
  ["Asst Professor 9 Mo SAL (School of Information)", "63407"],
  ["Teaching Faculty - Undergrad Clinical-focused, 12 Month Salaried (multiple vacancies) - College of Nursing", "62714"],
  ["Teaching Faculty I (Assistant Clinical Professor), 12 Month Salaried - Elementary Education - School of Teacher Education - Anne Spencer Daves College of Education, Health, and Human Sciences", "63375"],
]);
const STALE_FSU_TITLE = "Research Faculty I, 12 Month Salaried (Psychology)";

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function sha1(value) {
  return createHash("sha1").update(String(value || "")).digest("hex");
}

function withCanonicalJobId(job, url) {
  const canonicalGroupId = clean(job?.canonicalGroupId);
  if (!canonicalGroupId) return { ...job, url };
  const source = clean(job?.source).toLowerCase();
  const normalizedUrl = clean(url).toLowerCase();
  return {
    ...job,
    url,
    canonicalJobId: `job_${sha1([canonicalGroupId, source, normalizedUrl].join("|")).slice(0, 16)}`,
  };
}

function numericPeopleSoftId(url) {
  if (!/HRS_(?:APP_)?SCHJOB|HRS_CG_SEARCH/i.test(url)) return null;
  try {
    const fragment = decodeURIComponent(new URL(url).hash.slice(1));
    return /^\d+$/.test(fragment) ? fragment : null;
  } catch {
    return null;
  }
}

function upgrade(job) {
  const oldUrl = clean(job?.url);
  if (!oldUrl) return null;

  const numericId = numericPeopleSoftId(oldUrl);
  const fsuId = oldUrl.includes("jobs.omni.fsu.edu") ? FSU_JOB_IDS.get(clean(job?.title)) : null;
  const jobId = numericId || fsuId;
  if (!jobId) return null;

  const newUrl = peopleSoftJobDetailUrl(oldUrl, jobId);
  if (!newUrl || newUrl === oldUrl) return null;
  return { job: withCanonicalJobId(job, newUrl), oldUrl, newUrl, jobId };
}

const primary = JSON.parse(fs.readFileSync(path.join(ROOT, TARGETS[0]), "utf8"));
const jobs = Array.isArray(primary?.jobs) ? primary.jobs : [];
const nextJobs = [];
const updates = [];
const removed = [];
const hostCounts = {};

for (const job of jobs) {
  if (clean(job?.title) === STALE_FSU_TITLE && clean(job?.url).includes("jobs.omni.fsu.edu")) {
    removed.push({ title: clean(job.title), college: clean(job.college), url: clean(job.url), reason: "not_present_in_live_fsu_results" });
    continue;
  }
  const result = upgrade(job);
  if (!result) {
    nextJobs.push(job);
    continue;
  }
  nextJobs.push(result.job);
  const host = new URL(result.newUrl).hostname;
  hostCounts[host] = (hostCounts[host] || 0) + 1;
  updates.push({
    title: clean(job.title),
    college: clean(job.college),
    jobId: result.jobId,
    oldUrl: result.oldUrl,
    newUrl: result.newUrl,
  });
}

const nextPayload = { ...primary, count: nextJobs.length, jobs: nextJobs };
for (const relativePath of TARGETS) {
  const target = path.join(ROOT, relativePath);
  fs.writeFileSync(target, `${JSON.stringify(nextPayload, null, 2)}\n`, "utf8");
  console.log(`Wrote ${relativePath} (${nextJobs.length} jobs)`);
}

const report = {
  generatedAt: new Date().toISOString(),
  beforeCount: jobs.length,
  afterCount: nextJobs.length,
  upgradedCount: updates.length,
  removedCount: removed.length,
  hostCounts,
  removed,
  updates,
};
fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Upgraded ${updates.length} search-page URLs; removed ${removed.length} stale FSU listing`);
console.log(`Wrote ${path.relative(ROOT, REPORT_PATH)}`);
