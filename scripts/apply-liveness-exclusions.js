#!/usr/bin/env node
/**
 * apply-liveness-exclusions.js
 *
 * Adds postings that audit-posting-liveness.js found closed, dead, past their
 * stated deadline, or posted as a year-old PDF/Word file to
 * data/post-quality-exclusions.json. That file is honored by scrape-to-json.js
 * on every scrape, so removed postings can't be re-added by tomorrow's run even
 * if a school's listing page still links them. Run `npm run clean:post-quality`
 * afterwards to drop them from the published jobs.json files.
 *
 * Usage:
 *   node scripts/apply-liveness-exclusions.js --report <path> [--confirm <path>] [--dry-run]
 *
 *   --report   posting-liveness-report.json from the full audit
 *   --confirm  report from a second, independent pass over the problem set;
 *              when given, only postings flagged in BOTH passes are excluded
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeReviewedUrl } from "./lib/post-quality-exclusions.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXCLUSIONS_PATH = path.join(ROOT, "data", "post-quality-exclusions.json");
const REMOVE_VERDICTS = new Map([["closed", "posting_closed"], ["dead", "confirmed_dead_url"], ["expired", "expired_posting"], ["stale", "stale_document_posting"]]);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) { out[a.slice(2)] = true; continue; }
    out[a.slice(2)] = next;
    i++;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.report) { console.error("--report is required"); process.exit(1); }

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const flagged = (report) => new Map(
  (report.problems || []).filter((p) => REMOVE_VERDICTS.has(p.verdict)).map((p) => [normalizeReviewedUrl(p.url), p])
);

let candidates = flagged(readJson(path.resolve(args.report)));
if (args.confirm) {
  const confirmed = flagged(readJson(path.resolve(args.confirm)));
  const before = candidates.size;
  candidates = new Map([...candidates].filter(([url]) => confirmed.has(url)));
  console.log(`Second pass confirmed ${candidates.size}/${before} closed/dead postings`);
}

const payload = readJson(EXCLUSIONS_PATH);
const existing = new Set((payload.exclusions || []).map((e) => normalizeReviewedUrl(e.url)));
const today = new Date().toISOString().slice(0, 10);
const added = [];
for (const [url, p] of candidates) {
  if (existing.has(url)) continue;
  added.push({
    url: p.url,
    college: p.college,
    title: p.title,
    reason: REMOVE_VERDICTS.get(p.verdict),
    evidence: [p.httpCode ? `HTTP ${p.httpCode}` : "", p.note].filter(Boolean).join(" - ").slice(0, 200),
    reviewedAt: today,
  });
}

const counts = added.reduce((c, e) => ((c[e.reason] = (c[e.reason] || 0) + 1), c), {});
console.log(`Adding ${added.length} exclusions`, counts, `(${candidates.size - added.length} already excluded)`);

if (!args["dry-run"] && added.length) {
  const exclusions = [...(payload.exclusions || []), ...added].sort((a, b) => a.url.localeCompare(b.url));
  fs.writeFileSync(EXCLUSIONS_PATH, `${JSON.stringify({ ...payload, updatedAt: today, count: exclusions.length, exclusions }, null, 2)}\n`);
  console.log(`Wrote ${path.relative(ROOT, EXCLUSIONS_PATH)} (${exclusions.length} total)`);
}
