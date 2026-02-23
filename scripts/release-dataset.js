#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

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

function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputRel = args.input || "public/jobs.json";
  const releasesRel = args.outdir || "data/releases";
  const dateTag = args.date || isoDateOnly(new Date());

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateTag)) {
    throw new Error(`Invalid --date value: "${dateTag}". Use YYYY-MM-DD.`);
  }

  const inputPath = path.join(ROOT, inputRel);
  const outDir = path.join(ROOT, releasesRel);

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputRel}`);
  }

  const payload = readJson(inputPath);
  const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
  const headers = [
    "title",
    "url",
    "source",
    "category",
    "college",
    "location",
    "description",
    "department",
    "specialization",
    "systemGroup",
  ];

  const releaseJsonName = `${dateTag}.json`;
  const releaseCsvName = `${dateTag}.csv`;
  const releaseMetaName = `${dateTag}.metadata.json`;

  const releaseJsonPath = path.join(outDir, releaseJsonName);
  const releaseCsvPath = path.join(outDir, releaseCsvName);
  const releaseMetaPath = path.join(outDir, releaseMetaName);

  const latestJsonPath = path.join(outDir, "latest.json");
  const latestCsvPath = path.join(outDir, "latest.csv");
  const latestMetaPath = path.join(outDir, "latest.metadata.json");
  const indexPath = path.join(outDir, "index.json");

  const metadata = {
    generatedAt: new Date().toISOString(),
    date: dateTag,
    input: inputRel,
    scrapedAt: payload?.scrapedAt || null,
    count: jobs.length,
    fields: headers,
    files: {
      json: path.join(releasesRel, releaseJsonName).replace(/\\/g, "/"),
      csv: path.join(releasesRel, releaseCsvName).replace(/\\/g, "/"),
      metadata: path.join(releasesRel, releaseMetaName).replace(/\\/g, "/"),
    },
  };

  ensureDir(outDir);
  writeJson(releaseJsonPath, payload);
  fs.writeFileSync(releaseCsvPath, toCsv(jobs, headers), "utf8");
  writeJson(releaseMetaPath, metadata);

  writeJson(latestJsonPath, payload);
  fs.writeFileSync(latestCsvPath, toCsv(jobs, headers), "utf8");
  writeJson(latestMetaPath, metadata);

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
  console.log(`Updated aliases: ${path.relative(ROOT, latestJsonPath)}, ${path.relative(ROOT, latestCsvPath)}`);
  console.log(`Updated index: ${path.relative(ROOT, indexPath)}`);
}

main();
