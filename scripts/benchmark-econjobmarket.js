#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { compareEconJobMarket } from "./lib/external-benchmark.js";
import { readJobsFile } from "./lib/jobs-file.js";

const EJM_FEED = "https://backend.econjobmarket.org/data/zz_public/json/Ads";

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

async function main() {
  const jobsPath = path.resolve(argValue("--jobs") || "public/jobs.json");
  const feedPath = argValue("--feed");
  const outPath = argValue("--out");
  const includeDetails = process.argv.includes("--details");
  const jobsPayload = readJobsFile(jobsPath);
  const jobs = Array.isArray(jobsPayload) ? jobsPayload : jobsPayload.jobs || [];
  const snapshotDate = argValue("--snapshot") || jobsPayload.scrapedAt || new Date().toISOString();

  let ads;
  if (feedPath) {
    ads = readJson(path.resolve(feedPath));
  } else {
    const response = await fetch(EJM_FEED, {
      headers: { "User-Agent": "Faculty Atlas academic coverage benchmark/1.0" },
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) throw new Error(`EconJobMarket feed returned HTTP ${response.status}`);
    ads = await response.json();
  }

  const report = compareEconJobMarket({ ads, jobs, snapshotDate, includeDetails });
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (outPath) fs.writeFileSync(path.resolve(outPath), output, "utf8");
  process.stdout.write(output);
}

main().catch((error) => {
  console.error(`EconJobMarket benchmark failed: ${error?.message || error}`);
  process.exitCode = 1;
});
