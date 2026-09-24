import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(TEST_DIR, "../..");
const SCRIPT = path.join(ROOT, "scripts/release-dataset.js");

function digest(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

test("research release is publication-safe, classified, and reproducible", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "faculty-atlas-release-"));
  const inputPath = path.join(tempDir, "jobs.json");
  const outDir = path.join(tempDir, "release");
  const fixture = {
    scrapedAt: "2026-09-23T12:00:00.000Z",
    count: 4,
    jobs: [
      {
        canonicalJobId: "job-1",
        title: "Tenure-Track Assistant Professor of Economics",
        url: "https://example.edu/jobs/1",
        source: "TEST",
        college: "Example University",
        location: "Example City, CA",
        description: "Private working text that must not be released",
        descriptionFetchStatus: "success",
      },
      {
        canonicalJobId: "job-2",
        title: "Adjunct Instructor",
        url: "https://example.edu/jobs/2",
        source: "TEST",
        college: "Example University",
        location: "Example City, NY 10001",
      },
      {
        canonicalJobId: "job-3",
        title: "Open Rank Faculty - Variable Track",
        url: "https://example.edu/jobs/3",
        source: "TEST",
        college: "Example University",
        location: "Example City, TX",
      },
      {
        canonicalJobId: "job-4",
        title: "Professor of Economics",
        url: "https://example.edu/jobs/4",
        source: "TEST",
        college: "Example University",
        location: "Example City",
      },
    ],
  };
  fs.writeFileSync(inputPath, `${JSON.stringify(fixture)}\n`);

  const result = spawnSync(process.execPath, [SCRIPT, "--input", inputPath, "--outdir", outDir, "--date", "2026-09-23"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const jsonPath = path.join(outDir, "2026-09-23.json");
  const csvPath = path.join(outDir, "2026-09-23.csv");
  const metadataPath = path.join(outDir, "2026-09-23.metadata.json");
  const release = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  const checksums = fs.readFileSync(path.join(outDir, "2026-09-23.sha256"), "utf8");

  assert.equal(release.schemaVersion, "1.0.0");
  assert.equal(release.count, 4);
  assert.deepEqual(release.jobs.map((job) => job.appointmentTrack), [
    "tenure-track",
    "non-tenure-track",
    "variable",
    "unclassified",
  ]);
  assert.deepEqual(release.jobs.map((job) => job.state), ["CA", "NY", "TX", null]);
  assert.equal("description" in release.jobs[0], false);
  assert.equal("descriptionFetchStatus" in release.jobs[0], false);
  assert.deepEqual(metadata.appointmentTrackCounts, {
    tenureTrack: 1,
    nonTenureTrack: 1,
    variable: 1,
    unclassified: 1,
  });
  assert.equal(metadata.hashes.json.value, digest(jsonPath));
  assert.equal(metadata.hashes.csv.value, digest(csvPath));
  assert.match(checksums, new RegExp(`^${digest(jsonPath)}  2026-09-23\\.json$`, "m"));
  assert.match(checksums, new RegExp(`^${digest(metadataPath)}  2026-09-23\\.metadata\\.json$`, "m"));
});
