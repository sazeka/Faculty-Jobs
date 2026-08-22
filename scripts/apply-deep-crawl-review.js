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

const master = JSON.parse(fs.readFileSync(MASTER_PATH, "utf8"));
const discovery = JSON.parse(fs.readFileSync(DISCOVERY_PATH, "utf8"));
const acceptedPayload = JSON.parse(fs.readFileSync(ACCEPTED_PATH, "utf8"));
const accepted = new Map((acceptedPayload.items || []).map((item) => [key(item.name), item]));
const institutions = new Map((master.institutions || []).map((item) => [key(item.name), item]));
const reviewed = (discovery.results || []).filter((item) => item.status === "discovered");
const applied = [];
const rejected = [];

for (const result of reviewed) {
  const institution = institutions.get(key(result.name));
  if (!institution) continue;
  const approved = accepted.get(key(result.name));
  if (approved) {
    institution.career_url = approved.career_url;
    institution.platform_type = approved.platform_type || "generic";
    institution.last_discovery_status = "deep_crawl_validated";
    institution.last_discovery_confidence = Number(approved.confidence || result.confidence || 0.65);
    applied.push({ name: result.name, career_url: approved.career_url, platform_type: institution.platform_type });
    continue;
  }

  if (clean(institution.career_url) === clean(result.career_url)) institution.career_url = null;
  institution.last_discovery_status = "deep_crawl_rejected_identity";
  institution.last_discovery_confidence = 0;
  institution.notes = clean(`${institution.notes || ""} Deep crawl candidate rejected during institution-identity review.`);
  rejected.push({ name: result.name, rejected_url: result.career_url, reason: "institution identity mismatch, third-party aggregator, directory, or individual job detail" });
}

master.generatedAt = new Date().toISOString();
fs.writeFileSync(MASTER_PATH, JSON.stringify(master, null, 2) + "\n");
fs.writeFileSync(
  REVIEW_PATH,
  JSON.stringify({ generatedAt: new Date().toISOString(), reviewed: reviewed.length, applied, rejected }, null, 2) + "\n"
);
console.log(`Reviewed ${reviewed.length}: accepted ${applied.length}, rejected ${rejected.length}`);
