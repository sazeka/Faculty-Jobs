#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lowerCoverageThresholds } from "./lib/coverage-health.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const thresholdsPath = path.join(root, "data", "coverage-alert-thresholds.json");
const reportPath = path.join(root, "generated", "coverage-report.json");

const current = JSON.parse(fs.readFileSync(thresholdsPath, "utf8"));
const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const next = lowerCoverageThresholds(current, report);

fs.writeFileSync(thresholdsPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
console.log(`Coverage alert watermark: missing <= ${next.maxMissing}, pending <= ${next.maxPending}`);
