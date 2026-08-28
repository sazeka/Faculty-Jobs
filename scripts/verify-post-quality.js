#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  POST_QUALITY_VERSION,
  deterministicStratifiedSample,
  scoreCatalog,
  summarizeHumanLabels,
} from "./lib/post-quality.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const JOBS_PATH = path.join(ROOT, "public", "jobs.json");
const REPORT_PATH = path.join(ROOT, "generated", "post-quality-report.json");
const DRIFT_PATH = path.join(ROOT, "generated", "post-quality-drift.json");
const QUARANTINE_PATH = path.join(ROOT, "generated", "post-quality-quarantine.json");
const SAMPLE_PATH = path.join(ROOT, "generated", "post-quality-review-sample.json");
const DASHBOARD_PATHS = [
  path.join(ROOT, "generated", "post-quality-dashboard.html"),
  path.join(ROOT, "public", "post-quality-dashboard.html"),
  path.join(ROOT, "docs", "post-quality-dashboard.html"),
];
const SOURCE_THRESHOLDS_PATH = path.join(ROOT, "data", "post-quality-source-thresholds.json");
const HUMAN_LABELS_PATH = path.join(ROOT, "data", "post-quality-human-labels.json");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function pct(numerator, denominator) {
  return denominator > 0 ? Number(((numerator / denominator) * 100).toFixed(2)) : 0;
}

function average(values) {
  const numbers = values.filter(Number.isFinite);
  return numbers.length ? Number((numbers.reduce((sum, value) => sum + value, 0) / numbers.length).toFixed(2)) : 0;
}

function readJsonOrNull(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function isLikelyJobUrl(url) {
  const value = String(url || "");
  if (!/^https?:\/\//i.test(value)) return false;
  if (/\/faculty(?:\/|$|\?)/i.test(value) && !/\/(job|jobs|career|careers|employment|positions?|openings?|vacanc(y|ies))\b/i.test(value)) return false;
  if (/\/(directory|people|our-faculty|faculty-profiles?|faculty-staff)\b/i.test(value)) return false;
  return true;
}

function isPlaceholderTitle(title) {
  const value = clean(title).toLowerCase();
  return !value || /^(faculty|staff|faculty jobs|employment|careers?|view details|learn more|read more|click here)$/.test(value);
}

function summarizeRows(rows) {
  let nonJob = 0;
  let nonHttps = 0;
  let missingDesc = 0;
  let placeholderTitles = 0;
  for (const job of rows) {
    const url = clean(job?.url);
    if (!isLikelyJobUrl(url)) nonJob += 1;
    if (!/^https:\/\//i.test(url)) nonHttps += 1;
    if (!clean(job?.description)) missingDesc += 1;
    if (isPlaceholderTitle(job?.title)) placeholderTitles += 1;
  }
  return {
    count: rows.length,
    counts: { nonJob, nonHttps, missingDesc, placeholderTitles },
    percents: { nonHttpsPct: pct(nonHttps, rows.length), missingDescPct: pct(missingDesc, rows.length) },
  };
}

function countStatuses(rows) {
  const counts = { pass: 0, review: 0, quarantine: 0 };
  for (const row of rows) counts[row.quality.status] = (counts[row.quality.status] || 0) + 1;
  return counts;
}

function countReasons(rows) {
  const counts = new Map();
  for (const row of rows) {
    for (const reason of row.quality.reasons) {
      const current = counts.get(reason.code) || { code: reason.code, severity: reason.severity, dimension: reason.dimension, count: 0 };
      current.count += 1;
      counts.set(reason.code, current);
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}

function qualitySummary(rows) {
  const statusCounts = countStatuses(rows);
  const dimensionNames = ["relevance", "attribution", "link", "freshness", "completeness", "duplication"];
  const dimensionAverages = Object.fromEntries(
    dimensionNames.map((dimension) => [dimension, average(rows.map((row) => row.quality.dimensions[dimension]))]),
  );
  return {
    averageScore: average(rows.map((row) => row.quality.score)),
    statusCounts,
    statusPercents: Object.fromEntries(Object.entries(statusCounts).map(([key, value]) => [key, pct(value, rows.length)])),
    dimensionAverages,
    reasonCounts: countReasons(rows),
  };
}

function loadSourceThresholds() {
  const data = readJsonOrNull(SOURCE_THRESHOLDS_PATH) || {};
  return {
    default: {
      maxNonJob: Number(data?.default?.maxNonJob ?? 0),
      maxNonHttpsPct: Number(data?.default?.maxNonHttpsPct ?? 1),
      maxPlaceholderTitles: Number(data?.default?.maxPlaceholderTitles ?? 0),
      maxMissingDescPct: Number(data?.default?.maxMissingDescPct ?? 95),
    },
    sources: typeof data?.sources === "object" && data.sources ? data.sources : {},
  };
}

function compactRow(row, includeHumanFields = false) {
  const result = {
    id: row.quality.id,
    score: row.quality.score,
    status: row.quality.status,
    title: clean(row.job?.title),
    college: clean(row.job?.college),
    source: clean(row.job?.source) || "Unknown",
    url: clean(row.job?.url),
    reasons: row.quality.reasons.map(({ code, severity, dimension, deduction, detail }) => ({ code, severity, dimension, deduction, detail })),
  };
  if (includeHumanFields) return { ...result, humanLabel: null, notes: "" };
  return result;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function safeLink(url) {
  try {
    const parsed = new URL(url);
    return /^https?:$/.test(parsed.protocol) ? escapeHtml(parsed.href) : "#";
  } catch {
    return "#";
  }
}

function buildDashboard(summary, quarantineRows, failures) {
  const sourceRows = summary.bySource
    .slice()
    .sort((a, b) => b.statusPercents.quarantine - a.statusPercents.quarantine || b.count - a.count)
    .map((row) => `<tr><td>${escapeHtml(row.source)}</td><td>${row.count}</td><td>${row.averageScore}</td><td>${row.statusCounts.pass}</td><td>${row.statusCounts.review}</td><td>${row.statusCounts.quarantine} (${row.statusPercents.quarantine}%)</td><td>${escapeHtml(row.reasonCounts.slice(0, 3).map((reason) => `${reason.code} (${reason.count})`).join(", ") || "—")}</td></tr>`)
    .join("\n");
  const reasonRows = summary.reasonCounts.slice(0, 15)
    .map((reason) => `<tr><td><code>${escapeHtml(reason.code)}</code></td><td>${escapeHtml(reason.severity)}</td><td>${escapeHtml(reason.dimension)}</td><td>${reason.count}</td></tr>`)
    .join("\n");
  const quarantineHtml = quarantineRows.slice(0, 100)
    .map((row) => `<tr><td>${row.quality.score}</td><td><a href="${safeLink(row.job?.url)}" target="_blank" rel="noopener">${escapeHtml(row.job?.title || "Untitled")}</a><div class="muted">${escapeHtml(row.job?.college)}</div></td><td>${escapeHtml(row.job?.source || "Unknown")}</td><td>${escapeHtml(row.quality.reasons.filter((reason) => reason.severity === "error").map((reason) => reason.code).join(", "))}</td></tr>`)
    .join("\n");
  const dimensionCards = Object.entries(summary.dimensionAverages)
    .map(([name, value]) => `<div class="card"><div class="label">${escapeHtml(name)}</div><div class="value small">${value}</div></div>`)
    .join("\n");
  const failureHtml = failures.length
    ? `<div class="alert"><strong>Threshold failures</strong><ul>${failures.map((failure) => `<li>${escapeHtml(failure)}</li>`).join("")}</ul></div>`
    : `<div class="ok">All configured automated thresholds passed.</div>`;
  const precision = summary.humanReview.precisionPct == null ? "Not yet measured" : `${summary.humanReview.precisionPct}%`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Faculty Jobs Post Quality</title>
<style>
:root{color-scheme:light;--ink:#152439;--muted:#607086;--line:#dbe3ec;--panel:#f6f9fc;--blue:#1f5f99;--red:#9b2c2c;--green:#17643c}*{box-sizing:border-box}body{margin:0;background:#fff;color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.wrap{width:min(1180px,calc(100% - 32px));margin:36px auto 64px}h1{font-size:clamp(30px,5vw,48px);line-height:1.05;margin:0 0 8px}h2{margin:34px 0 12px}.muted,.meta{color:var(--muted)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:12px;margin:22px 0}.card{border:1px solid var(--line);border-radius:14px;padding:15px;background:var(--panel)}.label{text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-size:11px;font-weight:700}.value{font-size:28px;font-weight:750}.value.small{font-size:22px}.ok,.alert{border-radius:10px;padding:12px 15px;margin:18px 0}.ok{background:#edf8f1;color:var(--green)}.alert{background:#fff0f0;color:var(--red)}.table-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:12px}table{width:100%;border-collapse:collapse;min-width:720px}th,td{text-align:left;padding:9px 11px;border-bottom:1px solid var(--line);vertical-align:top}th{background:#eef3f8;font-size:12px}tr:last-child td{border-bottom:0}a{color:var(--blue)}code{font-size:12px}.note{border-left:4px solid var(--blue);padding:4px 14px;color:var(--muted)}
</style></head><body><main class="wrap">
<h1>Post quality dashboard</h1><p class="meta">Generated ${escapeHtml(summary.generatedAt)} · scoring model v${summary.qualityVersion}</p>
<p class="note">This is a report-only audit. Quarantined posts remain in the public catalog until a person confirms that they should be excluded.</p>
<div class="grid">
<div class="card"><div class="label">Average score</div><div class="value">${summary.averageScore}</div></div>
<div class="card"><div class="label">Pass</div><div class="value">${summary.statusCounts.pass}</div><div class="muted">${summary.statusPercents.pass}%</div></div>
<div class="card"><div class="label">Review</div><div class="value">${summary.statusCounts.review}</div><div class="muted">${summary.statusPercents.review}%</div></div>
<div class="card"><div class="label">Quarantine</div><div class="value">${summary.statusCounts.quarantine}</div><div class="muted">${summary.statusPercents.quarantine}%</div></div>
<div class="card"><div class="label">Reviewed precision</div><div class="value small">${precision}</div><div class="muted">${summary.humanReview.reviewed} labels</div></div>
<div class="card"><div class="label">Missing descriptions</div><div class="value small">${summary.counts.missingDesc}</div><div class="muted">${summary.percents.missingDescPct}%</div></div>
</div>${failureHtml}
<h2>Dimension averages</h2><div class="grid">${dimensionCards}</div>
<h2>Most common reason codes</h2><div class="table-wrap"><table><thead><tr><th>Reason</th><th>Severity</th><th>Dimension</th><th>Posts</th></tr></thead><tbody>${reasonRows}</tbody></table></div>
<h2>Quality by source</h2><div class="table-wrap"><table><thead><tr><th>Source</th><th>Posts</th><th>Score</th><th>Pass</th><th>Review</th><th>Quarantine</th><th>Top reasons</th></tr></thead><tbody>${sourceRows}</tbody></table></div>
<h2>Quarantine preview</h2><p class="muted">First 100 candidates. The complete machine-readable list is generated as <code>post-quality-quarantine.json</code>.</p><div class="table-wrap"><table><thead><tr><th>Score</th><th>Post</th><th>Source</th><th>Error reasons</th></tr></thead><tbody>${quarantineHtml || "<tr><td colspan=4>None</td></tr>"}</tbody></table></div>
<h2>How it works</h2><p class="muted">Every post receives scores for relevance, institution attribution, link quality, freshness, completeness, and duplicate grouping. Conservative error rules nominate likely false positives for quarantine; warnings route ambiguous records to review. A deterministic source-and-status sample supports repeatable human precision checks.</p>
</main></body></html>`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const limits = {
    maxNonJob: Number(args["max-nonjob"] ?? 0),
    maxNonHttpsPct: Number(args["max-nonhttps-pct"] ?? 1),
    maxMissingDescPct: Number(args["max-missing-desc-pct"] ?? 90),
    maxPlaceholderTitles: Number(args["max-placeholder-titles"] ?? 0),
    maxQuarantinePct: Number(args["max-quarantine-pct"] ?? 100),
    minAverageScore: Number(args["min-average-score"] ?? 0),
  };
  const sampleSize = Math.max(0, Number(args["sample-size"] ?? 200));
  const previous = readJsonOrNull(REPORT_PATH);
  const payload = JSON.parse(fs.readFileSync(JOBS_PATH, "utf8"));
  const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
  const scoredRows = scoreCatalog(jobs);
  const overall = summarizeRows(jobs);
  const quality = qualitySummary(scoredRows);
  const humanLabels = readJsonOrNull(HUMAN_LABELS_PATH)?.labels || [];
  const humanLabelsById = new Map(humanLabels.map((label) => [clean(label?.id), label]));

  const bySourceMap = new Map();
  for (const row of scoredRows) {
    const source = clean(row.job?.source) || "Unknown";
    if (!bySourceMap.has(source)) bySourceMap.set(source, []);
    bySourceMap.get(source).push(row);
  }
  const bySource = [...bySourceMap.entries()].map(([source, rows]) => ({
    source,
    ...summarizeRows(rows.map((row) => row.job)),
    ...qualitySummary(rows),
  })).sort((a, b) => b.count - a.count);

  const summary = {
    generatedAt: new Date().toISOString(),
    qualityVersion: POST_QUALITY_VERSION,
    jobsCount: overall.count,
    counts: overall.counts,
    percents: overall.percents,
    thresholds: limits,
    ...quality,
    humanReview: summarizeHumanLabels(humanLabels),
    bySource,
  };

  const failures = [];
  if (summary.counts.nonJob > limits.maxNonJob) failures.push(`overall nonJob ${summary.counts.nonJob} > ${limits.maxNonJob}`);
  if (summary.percents.nonHttpsPct > limits.maxNonHttpsPct) failures.push(`overall nonHttpsPct ${summary.percents.nonHttpsPct}% > ${limits.maxNonHttpsPct}%`);
  if (summary.percents.missingDescPct > limits.maxMissingDescPct) failures.push(`overall missingDescPct ${summary.percents.missingDescPct}% > ${limits.maxMissingDescPct}%`);
  if (summary.counts.placeholderTitles > limits.maxPlaceholderTitles) failures.push(`overall placeholderTitles ${summary.counts.placeholderTitles} > ${limits.maxPlaceholderTitles}`);
  if (summary.statusPercents.quarantine > limits.maxQuarantinePct) failures.push(`overall quarantinePct ${summary.statusPercents.quarantine}% > ${limits.maxQuarantinePct}%`);
  if (summary.averageScore < limits.minAverageScore) failures.push(`overall averageScore ${summary.averageScore} < ${limits.minAverageScore}`);

  const sourceThresholds = loadSourceThresholds();
  for (const row of bySource) {
    const sourceConfig = sourceThresholds.sources[row.source] || {};
    const config = {
      maxNonJob: Number(sourceConfig.maxNonJob ?? sourceThresholds.default.maxNonJob),
      maxNonHttpsPct: Number(sourceConfig.maxNonHttpsPct ?? sourceThresholds.default.maxNonHttpsPct),
      maxPlaceholderTitles: Number(sourceConfig.maxPlaceholderTitles ?? sourceThresholds.default.maxPlaceholderTitles),
      maxMissingDescPct: Number(sourceConfig.maxMissingDescPct ?? sourceThresholds.default.maxMissingDescPct),
    };
    if (row.counts.nonJob > config.maxNonJob) failures.push(`${row.source}: nonJob ${row.counts.nonJob} > ${config.maxNonJob}`);
    if (row.percents.nonHttpsPct > config.maxNonHttpsPct) failures.push(`${row.source}: nonHttpsPct ${row.percents.nonHttpsPct}% > ${config.maxNonHttpsPct}%`);
    if (row.counts.placeholderTitles > config.maxPlaceholderTitles) failures.push(`${row.source}: placeholderTitles ${row.counts.placeholderTitles} > ${config.maxPlaceholderTitles}`);
    if (row.percents.missingDescPct > config.maxMissingDescPct) failures.push(`${row.source}: missingDescPct ${row.percents.missingDescPct}% > ${config.maxMissingDescPct}%`);
  }

  const quarantineRows = scoredRows.filter((row) => row.quality.status === "quarantine");
  const reviewSample = deterministicStratifiedSample(scoredRows, { size: sampleSize });
  const quarantine = {
    generatedAt: summary.generatedAt,
    qualityVersion: POST_QUALITY_VERSION,
    reportOnly: true,
    count: quarantineRows.length,
    items: quarantineRows.map((row) => compactRow(row)),
  };
  const sample = {
    generatedAt: summary.generatedAt,
    qualityVersion: POST_QUALITY_VERSION,
    sampleSize: reviewSample.length,
    instructions: "Set humanLabel to valid or invalid, add optional notes, then copy confirmed labels into data/post-quality-human-labels.json.",
    items: reviewSample.map((row) => {
      const item = compactRow(row, true);
      const existing = humanLabelsById.get(item.id);
      return existing ? { ...item, humanLabel: existing.label ?? null, notes: existing.notes ?? "" } : item;
    }),
  };
  const drift = {
    generatedAt: summary.generatedAt,
    previousGeneratedAt: previous?.generatedAt || null,
    deltas: previous ? {
      jobsCount: summary.jobsCount - Number(previous.jobsCount || 0),
      nonJob: summary.counts.nonJob - Number(previous?.counts?.nonJob || 0),
      nonHttps: summary.counts.nonHttps - Number(previous?.counts?.nonHttps || 0),
      missingDesc: summary.counts.missingDesc - Number(previous?.counts?.missingDesc || 0),
      placeholderTitles: summary.counts.placeholderTitles - Number(previous?.counts?.placeholderTitles || 0),
      averageScore: Number((summary.averageScore - Number(previous?.averageScore || summary.averageScore)).toFixed(2)),
      pass: summary.statusCounts.pass - Number(previous?.statusCounts?.pass || 0),
      review: summary.statusCounts.review - Number(previous?.statusCounts?.review || 0),
      quarantine: summary.statusCounts.quarantine - Number(previous?.statusCounts?.quarantine || 0),
      nonHttpsPct: Number((summary.percents.nonHttpsPct - Number(previous?.percents?.nonHttpsPct || 0)).toFixed(2)),
      missingDescPct: Number((summary.percents.missingDescPct - Number(previous?.percents?.missingDescPct || 0)).toFixed(2)),
    } : null,
  };

  for (const filePath of [REPORT_PATH, DRIFT_PATH, QUARANTINE_PATH, SAMPLE_PATH, ...DASHBOARD_PATHS]) fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(summary, null, 2)}\n`);
  fs.writeFileSync(DRIFT_PATH, `${JSON.stringify(drift, null, 2)}\n`);
  fs.writeFileSync(QUARANTINE_PATH, `${JSON.stringify(quarantine, null, 2)}\n`);
  fs.writeFileSync(SAMPLE_PATH, `${JSON.stringify(sample, null, 2)}\n`);
  const dashboard = buildDashboard(summary, quarantineRows, failures);
  for (const filePath of DASHBOARD_PATHS) fs.writeFileSync(filePath, dashboard);

  console.log(`Jobs: ${summary.jobsCount}`);
  console.log(`Average quality score: ${summary.averageScore}`);
  console.log(`Pass: ${summary.statusCounts.pass}; review: ${summary.statusCounts.review}; quarantine: ${summary.statusCounts.quarantine} (${summary.statusPercents.quarantine}%)`);
  console.log(`Missing descriptions: ${summary.counts.missingDesc} (${summary.percents.missingDescPct}%)`);
  console.log(`Wrote ${[REPORT_PATH, DRIFT_PATH, QUARANTINE_PATH, SAMPLE_PATH, ...DASHBOARD_PATHS].map((filePath) => path.relative(ROOT, filePath)).join(", ")}`);

  if (failures.length) {
    console.error("Post quality check failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log("Post quality check passed.");
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
