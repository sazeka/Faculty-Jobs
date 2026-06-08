#!/usr/bin/env node
/**
 * renormalize-titles.js
 *
 * Re-runs the canonical `normalizeJobTitle()` (from server.js) over every title
 * already stored in public/jobs.json + docs/jobs.json. Title-cleaning rules are
 * added to normalizeJobTitle continuously, but they only run at SCRAPE time — so
 * records captured before a rule existed keep their messy title until the next
 * time that exact listing is re-scraped (which may be never, if it dropped off
 * the source). This applies the current rules to the existing corpus in one pass.
 *
 * When a title changes, the canonical IDs (grp_/job_, derived from the title)
 * change too. To avoid resetting recency, the presence ledger
 * (generated/job-presence.json) is migrated: each changed job's firstSeen/lastSeen
 * entry is moved from the old canonicalJobId key to the new one. firstSeen already
 * stamped on the record is preserved as-is.
 *
 * Usage:
 *   node scripts/renormalize-titles.js [--dry-run]
 *
 * Follow with `node scripts/rebuild-data-chunks-all.js` to push the change live.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import { normalizeJobTitle } from "../server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PUBLIC_JOBS = path.join(ROOT, "public", "jobs.json");
const DOCS_JOBS = path.join(ROOT, "docs", "jobs.json");
const PRESENCE = path.join(ROOT, "generated", "job-presence.json");

const DRY_RUN = process.argv.includes("--dry-run");

// Canonical-ID derivation — must stay identical to scripts/realize-tn-scrape.js.
const clean = (v) => String(v || "").replace(/\s+/g, " ").trim();
const nk = (v) => clean(v).toLowerCase();
const sha1 = (v) => createHash("sha1").update(String(v || "")).digest("hex");
function canonicalIds(job, title) {
  const t = nk(title);
  const college = nk(job.college || "");
  const dept = nk(job.department || "");
  const state = nk(job.state || job.source || "");
  const source = nk(job.source || "");
  const url = nk(job.url || "");
  const canonicalGroupId = `grp_${sha1([t, college, dept, state].join("|")).slice(0, 16)}`;
  const canonicalJobId = `job_${sha1([canonicalGroupId, source, url].join("|")).slice(0, 16)}`;
  return { canonicalGroupId, canonicalJobId };
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}
function writeJson(p, v) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 2) + "\n", "utf8");
}

const payload = readJson(PUBLIC_JOBS);
if (!payload?.jobs?.length) {
  console.error("  Cannot read public/jobs.json");
  process.exit(1);
}
const presenceDoc = readJson(PRESENCE);
const presence = presenceDoc && presenceDoc.jobs ? presenceDoc : null;

let changed = 0;
let idChanged = 0;
let ledgerMigrated = 0;
const samples = [];

for (const job of payload.jobs) {
  const before = job.title || "";
  const after = normalizeJobTitle(before);
  // normalizeJobTitle can reject non-jobs (returns false / "") — never blank a
  // title here; that filtering belongs to the scrape pipeline, not this pass.
  if (typeof after !== "string" || !after.trim() || after === before) continue;

  changed++;
  if (samples.length < 30) samples.push([before, after]);

  const oldJobId = job.canonicalJobId;
  job.title = after;
  const { canonicalGroupId, canonicalJobId } = canonicalIds(job, after);

  if (canonicalJobId !== oldJobId) {
    idChanged++;
    job.canonicalGroupId = canonicalGroupId;
    job.canonicalJobId = canonicalJobId;
    // Migrate the presence ledger so firstSeen survives the ID change.
    if (presence && oldJobId && presence.jobs[oldJobId]) {
      if (!presence.jobs[canonicalJobId]) {
        presence.jobs[canonicalJobId] = presence.jobs[oldJobId];
        ledgerMigrated++;
      }
      delete presence.jobs[oldJobId];
    }
  }
}

console.log("\nFaculty Atlas — Title Re-normalization");
console.log(`  Total jobs        : ${payload.jobs.length.toLocaleString()}`);
console.log(`  Titles changed    : ${changed.toLocaleString()}`);
console.log(`  Canonical IDs new : ${idChanged.toLocaleString()}`);
console.log(`  Ledger entries mvd: ${ledgerMigrated.toLocaleString()}`);
console.log("\n  Sample changes:");
for (const [b, a] of samples) {
  console.log(`    ${JSON.stringify(b)}\n      → ${JSON.stringify(a)}`);
}

if (DRY_RUN) {
  console.log("\n  *** DRY RUN — no files written ***\n");
  process.exit(0);
}

writeJson(PUBLIC_JOBS, payload);
if (fs.existsSync(DOCS_JOBS)) writeJson(DOCS_JOBS, payload);
if (presence) writeJson(PRESENCE, presence);

console.log("\n  Wrote public/jobs.json" + (fs.existsSync(DOCS_JOBS) ? " + docs/jobs.json" : "") + (presence ? " + generated/job-presence.json" : ""));
console.log("  Next: node scripts/rebuild-data-chunks-all.js\n");
