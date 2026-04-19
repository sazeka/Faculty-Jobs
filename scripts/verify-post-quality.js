#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const JOBS_PATH = path.join(ROOT, "public", "jobs.json");
const REPORT_PATH = path.join(ROOT, "generated", "post-quality-report.json");
const DRIFT_PATH = path.join(ROOT, "generated", "post-quality-drift.json");
const DASHBOARD_PATH = path.join(ROOT, "generated", "post-quality-dashboard.html");
const SOURCE_THRESHOLDS_PATH = path.join(ROOT, "data", "post-quality-source-thresholds.json");

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

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function pct(n, d) {
  return d > 0 ? (n / d) * 100 : 0;
}

function readJsonOrNull(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function isLikelyJobUrl(url) {
  const u = String(url || "");
  if (!/^https?:\/\//i.test(u)) return false;
  if (/\/faculty(?:\/|$|\?)/i.test(u) && !/\/(job|jobs|career|careers|employment|positions?|openings?|vacanc(y|ies))\b/i.test(u)) {
    return false;
  }
  if (/\/(directory|people|our-faculty|faculty-profiles?|faculty-staff)\b/i.test(u)) return false;
  return true;
}

function isPlaceholderTitle(title) {
  const t = clean(title).toLowerCase();
  return (
    !t ||
    /^(faculty|staff|faculty jobs|employment|careers?)$/.test(t) ||
    /^(view details|learn more|read more|click here)$/.test(t)
  );
}

function summarizeRows(rows) {
  let nonJob = 0;
  let nonHttps = 0;
  let missingDesc = 0;
  let placeholderTitles = 0;

  for (const job of rows) {
    const url = clean(job?.url);
    const title = clean(job?.title);
    const desc = clean(job?.description);

    if (!isLikelyJobUrl(url)) nonJob += 1;
    if (!/^https:\/\//i.test(url)) nonHttps += 1;
    if (!desc) missingDesc += 1;
    if (isPlaceholderTitle(title)) placeholderTitles += 1;
  }

  return {
    count: rows.length,
    counts: { nonJob, nonHttps, missingDesc, placeholderTitles },
    percents: {
      nonHttpsPct: Number(pct(nonHttps, rows.length).toFixed(2)),
      missingDescPct: Number(pct(missingDesc, rows.length).toFixed(2)),
    },
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
    sources: typeof data?.sources === "object" && data?.sources ? data.sources : {},
  };
}

function buildDashboard(summary, failures) {
  const rows = (summary.bySource || [])
    .slice(0, 40)
    .map((r) => `<tr><td>${r.source}</td><td>${r.count}</td><td>${r.counts.nonJob}</td><td>${r.percents.nonHttpsPct}%</td><td>${r.percents.missingDescPct}%</td><td>${r.counts.placeholderTitles}</td></tr>`)
    .join("\n");

  const failRows = failures.length
    ? failures.map((f) => `<li>${f}</li>`).join("\n")
    : "<li>None</li>";

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Post Quality Dashboard</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; margin: 24px; color: #1b2430; }
    h1 { margin: 0 0 8px; }
    .meta { color: #536174; margin-bottom: 16px; }
    .grid { display: grid; grid-template-columns: repeat(4, minmax(140px, 1fr)); gap: 10px; margin-bottom: 16px; }
    .card { border: 1px solid #d9e0ea; border-radius: 10px; padding: 10px; background: #f8fafc; }
    .card .k { font-size: 12px; color: #5e6c7f; text-transform: uppercase; }
    .card .v { font-size: 20px; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #d9e0ea; padding: 6px 8px; font-size: 13px; text-align: left; }
    th { background: #eef3f8; }
    .fail { color: #8b1c1c; }
  </style>
</head>
<body>
  <h1>Post Quality Dashboard</h1>
  <p class="meta">Generated: ${summary.generatedAt}</p>
  <div class="grid">
    <div class="card"><div class="k">Jobs</div><div class="v">${summary.jobsCount}</div></div>
    <div class="card"><div class="k">Non-job</div><div class="v">${summary.counts.nonJob}</div></div>
    <div class="card"><div class="k">Non-HTTPS</div><div class="v">${summary.counts.nonHttps} (${summary.percents.nonHttpsPct}%)</div></div>
    <div class="card"><div class="k">Missing Desc</div><div class="v">${summary.counts.missingDesc} (${summary.percents.missingDescPct}%)</div></div>
  </div>
  <h2>Failures</h2>
  <ul class="fail">${failRows}</ul>
  <h2>By Source (Top 40 by count)</h2>
  <table>
    <thead><tr><th>Source</th><th>Jobs</th><th>Non-job</th><th>Non-HTTPS</th><th>Missing Desc</th><th>Placeholder Titles</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const maxNonJob = Number(args["max-nonjob"] ?? 0);
  const maxNonHttpsPct = Number(args["max-nonhttps-pct"] ?? 1);
  const maxMissingDescPct = Number(args["max-missing-desc-pct"] ?? 90);
  const maxPlaceholderTitles = Number(args["max-placeholder-titles"] ?? 0);

  const prevReport = readJsonOrNull(REPORT_PATH);
  const payload = JSON.parse(fs.readFileSync(JOBS_PATH, "utf8"));
  const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];

  const overall = summarizeRows(jobs);
  const bySourceMap = new Map();
  for (const job of jobs) {
    const source = clean(job?.source) || "Unknown";
    if (!bySourceMap.has(source)) bySourceMap.set(source, []);
    bySourceMap.get(source).push(job);
  }

  const bySource = [...bySourceMap.entries()]
    .map(([source, rows]) => ({ source, ...summarizeRows(rows) }))
    .sort((a, b) => b.count - a.count);

  const summary = {
    generatedAt: new Date().toISOString(),
    jobsCount: overall.count,
    counts: overall.counts,
    percents: overall.percents,
    thresholds: { maxNonJob, maxNonHttpsPct, maxMissingDescPct, maxPlaceholderTitles },
    bySource,
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  console.log(`Jobs: ${jobs.length}`);
  console.log(`Non-job links: ${summary.counts.nonJob}`);
  console.log(`Non-HTTPS: ${summary.counts.nonHttps} (${summary.percents.nonHttpsPct}%)`);
  console.log(`Missing descriptions: ${summary.counts.missingDesc} (${summary.percents.missingDescPct}%)`);
  console.log(`Placeholder titles: ${summary.counts.placeholderTitles}`);

  const failures = [];
  if (summary.counts.nonJob > maxNonJob) failures.push(`overall nonJob ${summary.counts.nonJob} > ${maxNonJob}`);
  if (summary.percents.nonHttpsPct > maxNonHttpsPct) failures.push(`overall nonHttpsPct ${summary.percents.nonHttpsPct}% > ${maxNonHttpsPct}%`);
  if (summary.percents.missingDescPct > maxMissingDescPct) failures.push(`overall missingDescPct ${summary.percents.missingDescPct}% > ${maxMissingDescPct}%`);
  if (summary.counts.placeholderTitles > maxPlaceholderTitles) failures.push(`overall placeholderTitles ${summary.counts.placeholderTitles} > ${maxPlaceholderTitles}`);

  const sourceThresholds = loadSourceThresholds();
  for (const row of bySource) {
    const srcCfg = sourceThresholds.sources[row.source] || {};
    const cfg = {
      maxNonJob: Number(srcCfg.maxNonJob ?? sourceThresholds.default.maxNonJob),
      maxNonHttpsPct: Number(srcCfg.maxNonHttpsPct ?? sourceThresholds.default.maxNonHttpsPct),
      maxPlaceholderTitles: Number(srcCfg.maxPlaceholderTitles ?? sourceThresholds.default.maxPlaceholderTitles),
      maxMissingDescPct: Number(srcCfg.maxMissingDescPct ?? sourceThresholds.default.maxMissingDescPct),
    };

    if (row.counts.nonJob > cfg.maxNonJob) failures.push(`${row.source}: nonJob ${row.counts.nonJob} > ${cfg.maxNonJob}`);
    if (row.percents.nonHttpsPct > cfg.maxNonHttpsPct) failures.push(`${row.source}: nonHttpsPct ${row.percents.nonHttpsPct}% > ${cfg.maxNonHttpsPct}%`);
    if (row.counts.placeholderTitles > cfg.maxPlaceholderTitles) failures.push(`${row.source}: placeholderTitles ${row.counts.placeholderTitles} > ${cfg.maxPlaceholderTitles}`);
    if (row.percents.missingDescPct > cfg.maxMissingDescPct) failures.push(`${row.source}: missingDescPct ${row.percents.missingDescPct}% > ${cfg.maxMissingDescPct}%`);
  }

  const drift = {
    generatedAt: new Date().toISOString(),
    previousGeneratedAt: prevReport?.generatedAt || null,
    deltas: prevReport
      ? {
          jobsCount: summary.jobsCount - Number(prevReport.jobsCount || 0),
          nonJob: summary.counts.nonJob - Number(prevReport?.counts?.nonJob || 0),
          nonHttps: summary.counts.nonHttps - Number(prevReport?.counts?.nonHttps || 0),
          missingDesc: summary.counts.missingDesc - Number(prevReport?.counts?.missingDesc || 0),
          placeholderTitles: summary.counts.placeholderTitles - Number(prevReport?.counts?.placeholderTitles || 0),
          nonHttpsPct: Number((summary.percents.nonHttpsPct - Number(prevReport?.percents?.nonHttpsPct || 0)).toFixed(2)),
          missingDescPct: Number((summary.percents.missingDescPct - Number(prevReport?.percents?.missingDescPct || 0)).toFixed(2)),
        }
      : null,
  };

  fs.writeFileSync(DRIFT_PATH, `${JSON.stringify(drift, null, 2)}\n`, "utf8");
  fs.writeFileSync(DASHBOARD_PATH, buildDashboard(summary, failures), "utf8");

  console.log(`Wrote ${path.relative(ROOT, REPORT_PATH)}`);
  console.log(`Wrote ${path.relative(ROOT, DRIFT_PATH)}`);
  console.log(`Wrote ${path.relative(ROOT, DASHBOARD_PATH)}`);

  if (failures.length > 0) {
    console.error("Post quality check failed:");
    for (const f of failures) console.error(`- ${f}`);
    process.exit(1);
  }

  console.log("Post quality check passed.");
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
