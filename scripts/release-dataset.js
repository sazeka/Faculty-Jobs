#!/usr/bin/env node
import fs from "fs";
import path from "path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "url";
import { readJobsFile } from "./lib/jobs-file.js";
import {
  classifyTenureTrackWithEvidence,
  classifyVariableAppointmentTrack,
} from "./lib/weekly-tenure-stats.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i += 1;
  }
  return out;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJsonOrNull(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, "\"\"")}"`;
  }
  return str;
}

function toCsv(rows, headers) {
  const head = headers.join(",");
  const body = rows
    .map((row) => headers.map((h) => csvEscape(row[h])).join(","))
    .join("\n");
  return body ? `${head}\n${body}\n` : `${head}\n`;
}

function isoDateOnly(d) {
  return d.toISOString().slice(0, 10);
}

function nullableString(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function deriveState(job) {
  const direct = nullableString(job?.state);
  if (direct && /^[A-Z]{2}$/.test(direct.toUpperCase())) return direct.toUpperCase();
  const location = nullableString(job?.location);
  const match = location?.match(/,\s*([A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?\s*$/i);
  return match ? match[1].toUpperCase() : null;
}

function appointmentTrack(job) {
  const classified = classifyTenureTrackWithEvidence(job);
  if (classified.value === true) {
    return { appointmentTrack: "tenure-track", appointmentTrackEvidence: classified.evidence || null };
  }
  if (classified.value === false) {
    return { appointmentTrack: "non-tenure-track", appointmentTrackEvidence: classified.evidence || null };
  }
  if (classifyVariableAppointmentTrack(job)) {
    return { appointmentTrack: "variable", appointmentTrackEvidence: "variable-track-language" };
  }
  return { appointmentTrack: "unclassified", appointmentTrackEvidence: null };
}

function projectJob(job) {
  const track = appointmentTrack(job);
  return {
    canonicalJobId: nullableString(job?.canonicalJobId),
    canonicalGroupId: nullableString(job?.canonicalGroupId),
    title: nullableString(job?.title),
    url: nullableString(job?.url),
    source: nullableString(job?.source),
    category: nullableString(job?.category),
    college: nullableString(job?.college),
    location: nullableString(job?.location),
    state: deriveState(job),
    department: nullableString(job?.department),
    specialization: nullableString(job?.specialization),
    discipline: nullableString(job?.discipline),
    positionType: nullableString(job?.positionType),
    appointmentTrack: track.appointmentTrack,
    appointmentTrackEvidence: track.appointmentTrackEvidence,
    datePosted: nullableString(job?.datePosted),
    closeDate: nullableString(job?.closeDate),
    startDate: nullableString(job?.startDate),
    firstSeen: nullableString(job?.firstSeen),
    openUntilFilled: typeof job?.openUntilFilled === "boolean" ? job.openUntilFilled : null,
    systemGroup: nullableString(job?.systemGroup),
  };
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function gitCommit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function isValidHttpUrl(value) {
  try {
    const u = new URL(String(value || ""));
    return /^https?:$/i.test(u.protocol);
  } catch {
    return false;
  }
}

function topCounts(map, limit = 10) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputRel = args.input || "public/jobs.json";
  const releasesRel = args.outdir || "data/releases";
  const dateTag = args.date || isoDateOnly(new Date());

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateTag)) {
    throw new Error(`Invalid --date value: "${dateTag}". Use YYYY-MM-DD.`);
  }

  const inputPath = path.resolve(ROOT, inputRel);
  const outDir = path.resolve(ROOT, releasesRel);

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputRel}`);
  }

  const payload = readJobsFile(inputPath);
  const sourceJobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
  const jobs = sourceJobs.map(projectJob);
  const headers = [
    "canonicalJobId",
    "canonicalGroupId",
    "title",
    "url",
    "source",
    "category",
    "college",
    "location",
    "state",
    "department",
    "specialization",
    "discipline",
    "positionType",
    "appointmentTrack",
    "appointmentTrackEvidence",
    "datePosted",
    "closeDate",
    "startDate",
    "firstSeen",
    "openUntilFilled",
    "systemGroup",
  ];

  const releaseJsonName = `${dateTag}.json`;
  const releaseCsvName = `${dateTag}.csv`;
  const releaseMetaName = `${dateTag}.metadata.json`;
  const releaseChecksumsName = `${dateTag}.sha256`;

  const releaseJsonPath = path.join(outDir, releaseJsonName);
  const releaseCsvPath = path.join(outDir, releaseCsvName);
  const releaseMetaPath = path.join(outDir, releaseMetaName);
  const releaseChecksumsPath = path.join(outDir, releaseChecksumsName);

  const latestJsonPath = path.join(outDir, "latest.json");
  const latestCsvPath = path.join(outDir, "latest.csv");
  const latestMetaPath = path.join(outDir, "latest.metadata.json");
  const latestChecksumsPath = path.join(outDir, "latest.sha256");
  const indexPath = path.join(outDir, "index.json");

  const invalidByCollege = new Map();
  const invalidBySource = new Map();
  let invalidUrlCount = 0;
  const urlSeen = new Set();
  let duplicateUrlCount = 0;
  for (const job of jobs) {
    const url = String(job?.url || "");
    if (!isValidHttpUrl(url)) {
      invalidUrlCount += 1;
      const college = String(job?.college || "Unknown").trim() || "Unknown";
      const source = String(job?.source || "Unknown").trim() || "Unknown";
      invalidByCollege.set(college, (invalidByCollege.get(college) || 0) + 1);
      invalidBySource.set(source, (invalidBySource.get(source) || 0) + 1);
      continue;
    }
    if (urlSeen.has(url)) duplicateUrlCount += 1;
    else urlSeen.add(url);
  }

  const linkHealthPath = path.join(ROOT, "generated", "career-link-verification.json");
  const linkHealth = readJsonOrNull(linkHealthPath);
  const linkHealthCounts = linkHealth?.counts || null;

  const releasePayload = {
    schemaVersion: "1.0.0",
    scrapedAt: payload?.scrapedAt || null,
    count: jobs.length,
    jobs,
  };

  const trackCounts = jobs.reduce((counts, job) => {
    counts[job.appointmentTrack] = (counts[job.appointmentTrack] || 0) + 1;
    return counts;
  }, {});

  ensureDir(outDir);
  writeJson(releaseJsonPath, releasePayload);
  fs.writeFileSync(releaseCsvPath, toCsv(jobs, headers), "utf8");

  const metadata = {
    title: "Faculty Atlas: Point-in-Time Faculty Job Postings in United States Higher Education",
    schemaVersion: "1.0.0",
    methodologyVersion: "2026-09",
    generatedAt: new Date().toISOString(),
    date: dateTag,
    input: inputRel,
    scrapedAt: payload?.scrapedAt || null,
    sourceCommit: gitCommit(),
    count: jobs.length,
    fields: headers,
    scope: {
      geography: "United States",
      unitOfObservation: "One publicly listed faculty-job record",
      descriptionsIncluded: false,
      note: "The release contains research metadata and source links, not full job descriptions.",
    },
    appointmentTrackCounts: {
      tenureTrack: trackCounts["tenure-track"] || 0,
      nonTenureTrack: trackCounts["non-tenure-track"] || 0,
      variable: trackCounts.variable || 0,
      unclassified: trackCounts.unclassified || 0,
    },
    files: {
      json: path.join(releasesRel, releaseJsonName).replace(/\\/g, "/"),
      csv: path.join(releasesRel, releaseCsvName).replace(/\\/g, "/"),
      metadata: path.join(releasesRel, releaseMetaName).replace(/\\/g, "/"),
      checksums: path.join(releasesRel, releaseChecksumsName).replace(/\\/g, "/"),
    },
    hashes: {
      json: { algorithm: "sha256", value: sha256(releaseJsonPath), bytes: fs.statSync(releaseJsonPath).size },
      csv: { algorithm: "sha256", value: sha256(releaseCsvPath), bytes: fs.statSync(releaseCsvPath).size },
    },
    diagnostics: {
      invalidJobUrls: {
        count: invalidUrlCount,
        byCollegeTop10: topCounts(invalidByCollege, 10),
        bySourceTop10: topCounts(invalidBySource, 10),
      },
      duplicateJobUrls: {
        count: duplicateUrlCount,
      },
      institutionCareerLinkHealth: linkHealthCounts
        ? {
            checked: Number(linkHealthCounts.checked || 0),
            healthy: Number(linkHealthCounts.healthy || 0),
            broken: Number(linkHealthCounts.broken || 0),
            quarantined: Number(linkHealthCounts.quarantined || 0),
            source: path.relative(ROOT, linkHealthPath).replace(/\\/g, "/"),
          }
        : null,
    },
  };

  writeJson(releaseMetaPath, metadata);
  const checksumText = [releaseJsonPath, releaseCsvPath, releaseMetaPath]
    .map((filePath) => `${sha256(filePath)}  ${path.basename(filePath)}`)
    .join("\n") + "\n";
  fs.writeFileSync(releaseChecksumsPath, checksumText, "utf8");

  writeJson(latestJsonPath, releasePayload);
  fs.writeFileSync(latestCsvPath, toCsv(jobs, headers), "utf8");
  writeJson(latestMetaPath, metadata);
  fs.writeFileSync(latestChecksumsPath, checksumText, "utf8");

  let existingIndex = { generatedAt: null, releases: [] };
  if (fs.existsSync(indexPath)) {
    const candidate = readJson(indexPath);
    if (candidate && Array.isArray(candidate.releases)) {
      existingIndex = candidate;
    }
  }

  const currentReleases = Array.isArray(existingIndex.releases) ? existingIndex.releases : [];
  const byDate = new Map(currentReleases.map((r) => [r.date, r]));
  byDate.set(dateTag, {
    date: dateTag,
    count: jobs.length,
    scrapedAt: payload?.scrapedAt || null,
    json: `${dateTag}.json`,
    csv: `${dateTag}.csv`,
    metadata: `${dateTag}.metadata.json`,
    checksums: `${dateTag}.sha256`,
  });

  const releases = [...byDate.values()].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  writeJson(indexPath, {
    generatedAt: new Date().toISOString(),
    latest: dateTag,
    releases,
  });

  console.log(`Released dataset snapshot for ${dateTag}`);
  console.log(`- ${path.relative(ROOT, releaseJsonPath)}`);
  console.log(`- ${path.relative(ROOT, releaseCsvPath)}`);
  console.log(`- ${path.relative(ROOT, releaseMetaPath)}`);
  console.log(`- ${path.relative(ROOT, releaseChecksumsPath)}`);
  console.log(`Updated aliases: ${path.relative(ROOT, latestJsonPath)}, ${path.relative(ROOT, latestCsvPath)}`);
  console.log(`Updated index: ${path.relative(ROOT, indexPath)}`);
}

main();
