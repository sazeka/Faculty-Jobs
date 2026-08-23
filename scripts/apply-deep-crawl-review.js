#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MASTER_PATH = path.join(ROOT, "data", "institutions-master.json");
const DISCOVERY_PATH = path.join(ROOT, "generated", "career-discovery-report.json");
const ACCEPTED_PATH = path.join(ROOT, "generated", "promotion-candidates-deep-crawl.json");
const REVIEW_PATH = path.join(ROOT, "generated", "deep-crawl-review-report.json");
const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
const key = (value) => clean(value).toLowerCase();
const replayDiscoveryState = process.argv.includes("--replay-discovery-state");
const closeUnresolved = process.argv.includes("--close-unresolved");
const discoveryPaths = [];
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === "--discovery-report" && process.argv[i + 1]) {
    discoveryPaths.push(path.resolve(ROOT, process.argv[++i]));
  }
}
if (discoveryPaths.length === 0) discoveryPaths.push(DISCOVERY_PATH);

const master = JSON.parse(fs.readFileSync(MASTER_PATH, "utf8"));
const discoveries = discoveryPaths.map((reportPath) => JSON.parse(fs.readFileSync(reportPath, "utf8")));
const discoveryResults = discoveries.flatMap((report) =>
  (report.results || []).map((result) => ({ ...result, discoveryGeneratedAt: report.generatedAt })),
);
const acceptedPayload = JSON.parse(fs.readFileSync(ACCEPTED_PATH, "utf8"));
const accepted = new Map((acceptedPayload.items || []).map((item) => [key(item.name), item]));
const institutions = new Map((master.institutions || []).map((item) => [key(item.name), item]));
const reviewed = discoveryResults.filter((item) => item.status === "discovered" || accepted.has(key(item.name)));
const applied = [];
const rejected = [];

for (const result of discoveryResults) {
  const institution = institutions.get(key(result.name));
  if (!institution) continue;
  const approved = accepted.get(key(result.name));
  if (replayDiscoveryState) {
    institution.last_discovery_attempt_at = result.discoveryGeneratedAt;
    institution.last_discovery_status = result.status;
    institution.last_discovery_confidence = Number(result.confidence || 0);
    institution.discovery_attempts = Number(institution.discovery_attempts || 0) + 1;
  }
  // Human review may approve a candidate that deliberately remained below the
  // automatic promotion threshold. This is common for official employee career
  // gateways discovered from an institution's own homepage: they have strong
  // identity evidence but score 0.60 because the URL is not a recognized ATS.
  if (approved) {
    institution.career_url = approved.career_url;
    institution.platform_type = approved.platform_type || "generic";
    institution.last_discovery_status = "deep_crawl_validated";
    institution.last_discovery_confidence = Number(approved.confidence || result.confidence || 0.65);
    applied.push({ name: result.name, career_url: approved.career_url, platform_type: institution.platform_type });
    continue;
  }

  if (result.status !== "discovered") {
    if (closeUnresolved && result.status === "unresolved") {
      institution.last_discovery_status = "deep_crawl_unresolved";
      institution.last_discovery_confidence = 0;
    }
    continue;
  }
  if (clean(institution.career_url) === clean(result.career_url)) institution.career_url = null;
  institution.last_discovery_status = "deep_crawl_rejected_identity";
  institution.last_discovery_confidence = 0;
  const rejectionNote = "Deep crawl candidate rejected during institution-identity review.";
  if (!clean(institution.notes).includes(rejectionNote)) {
    institution.notes = clean(`${institution.notes || ""} ${rejectionNote}`);
  }
  rejected.push({ name: result.name, rejected_url: result.career_url, reason: "institution identity mismatch, third-party aggregator, directory, or individual job detail" });
}

master.generatedAt = new Date().toISOString();
fs.writeFileSync(MASTER_PATH, JSON.stringify(master, null, 2) + "\n");
fs.writeFileSync(
  REVIEW_PATH,
  JSON.stringify({ generatedAt: new Date().toISOString(), scanned: discoveryResults.length, reviewed: reviewed.length, applied, rejected }, null, 2) + "\n"
);
console.log(`Reviewed ${reviewed.length}: accepted ${applied.length}, rejected ${rejected.length}`);
