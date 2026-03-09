#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const VERIFY_PATH = path.join(ROOT, "generated", "career-link-verification.json");
const CRITICAL_PATH = path.join(ROOT, "data", "critical-schools.json");

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function main() {
  if (!fs.existsSync(VERIFY_PATH)) {
    throw new Error(`Missing verification report: ${path.relative(ROOT, VERIFY_PATH)}. Run npm run verify:career-links first.`);
  }

  const verify = readJson(VERIFY_PATH);
  const critical = new Set((readJson(CRITICAL_PATH).schools || []).map((x) => clean(x)).filter(Boolean));
  const rows = Array.isArray(verify?.institutions) ? verify.institutions : [];

  const failures = [];
  for (const nameKey of critical) {
    const row = rows.find((r) => clean(r.name) === nameKey);
    if (!row) {
      failures.push({ school: nameKey, reason: "missing_from_report" });
      continue;
    }

    if (!row.career_url || !/^https?:\/\//i.test(String(row.career_url))) {
      failures.push({ school: row.name, reason: "invalid_url_shape" });
      continue;
    }

    if (String(row.verification_status) !== "healthy") {
      failures.push({
        school: row.name,
        reason: row.verification_status || "unhealthy",
        http_status: row.http_status || null,
        error: row.error || null,
      });
    }
  }

  if (failures.length > 0) {
    console.error("Critical school link checks failed:");
    for (const f of failures) {
      console.error(`- ${f.school}: ${f.reason}${f.http_status ? ` (HTTP ${f.http_status})` : ""}${f.error ? ` (${f.error})` : ""}`);
    }
    process.exit(1);
  }

  console.log(`Critical school checks passed (${critical.size} schools).`);
}

main();
