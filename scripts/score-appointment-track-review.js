#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { scoreAppointmentTrackReview } from "./lib/appointment-track-review.js";

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function readJson(value, fallback) {
  return JSON.parse(fs.readFileSync(path.resolve(value || fallback), "utf8"));
}

const benchmark = readJson(argValue("--benchmark"), "generated/appointment-track-benchmark.json");
const reviewRows = readJson(argValue("--review"), "generated/appointment-track-review.json");
const currentPath = argValue("--current");
const outPath = path.resolve(argValue("--out") || "generated/appointment-track-review-score.json");
const report = scoreAppointmentTrackReview({
  benchmark,
  reviewRows,
  currentClassifications: currentPath ? readJson(currentPath) : null,
});

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ ...report, reviewSample: undefined }, null, 2)}\n`);
