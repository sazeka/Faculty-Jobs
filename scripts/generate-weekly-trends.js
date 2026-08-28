#!/usr/bin/env node
/**
 * generate-weekly-trends.js
 *
 * Computes weekly faculty hiring stats from jobs.json, then uses AI to
 * generate a prose narrative summary.
 *
 * Backend selection:
 *   default             → Ollama local
 *   AI_BACKEND=template → deterministic template summary (Actions)
 *   unavailable backend → template summary fallback
 *
 * Outputs:
 *   docs/data/weekly-trends.json     (served by GitHub Pages)
 *   public/data/weekly-trends.json
 *   generated/weekly-stats-history.json  (rolling 52-week record)
 *
 * Usage:
 *   node scripts/generate-weekly-trends.js [--dry-run]
 */
import fs from "fs";
import path from "path";
import http from "http";
import { fileURLToPath } from "url";
import { computeTenureTrackBreakdown } from "./lib/weekly-tenure-stats.js";
import { computeInstitutionControlBreakdown } from "./lib/weekly-institution-control-stats.js";
import { computeAiHiringBreakdown } from "./lib/weekly-ai-hiring-stats.js";
import { latestPriorWeek } from "./lib/weekly-trends-history.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const JOBS_PATH    = path.join(ROOT, "public", "jobs.json");
const INSTITUTIONS_PATH = path.join(ROOT, "data", "institutions-master.json");
const HISTORY_PATH = path.join(ROOT, "generated", "weekly-stats-history.json");
const OUT_PATHS    = [
  path.join(ROOT, "docs",   "data", "weekly-trends.json"),
  path.join(ROOT, "public", "data", "weekly-trends.json"),
];

// ── CLI / env ─────────────────────────────────────────────────────────────────

const DRY_RUN      = process.argv.includes("--dry-run");
const OLLAMA_HOST  = process.env.OLLAMA_HOST  || "localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5:7b";
const AI_BACKEND   = process.env.AI_BACKEND || "ollama";

// ── Helpers ───────────────────────────────────────────────────────────────────

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

function writeJson(p, v) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 2) + "\n", "utf8");
}

function isoWeekEnd() {
  // Sunday of the current week (end of week)
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  const day = d.getUTCDay(); // 0=Sun
  d.setUTCDate(d.getUTCDate() + (day === 0 ? 0 : 7 - day));
  return d.toISOString().slice(0, 10);
}

// ── Position-type detector ────────────────────────────────────────────────────

function detectPositionType(title) {
  const t = String(title || "").toLowerCase();
  if (t.includes("adjunct"))                                           return "Adjunct";
  if (t.includes("visiting"))                                          return "Visiting";
  if (t.includes("clinical"))                                          return "Clinical";
  if (t.includes("assistant professor") || /asst\.?\s+prof/.test(t))  return "Assistant Professor";
  if (t.includes("associate professor") || /assoc\.?\s+prof/.test(t)) return "Associate Professor";
  if (t.includes("professor"))                                         return "Professor (Full/Open Rank)";
  if (t.includes("instructor"))                                        return "Instructor";
  if (t.includes("lecturer"))                                          return "Lecturer";
  if (t.includes("postdoc"))                                           return "Postdoctoral";
  if (t.includes("research"))                                          return "Research Faculty";
  return "Other";
}

// ── Stats computation ─────────────────────────────────────────────────────────

function computeStats(jobs, institutions) {
  const bySource     = {};
  const byType       = {};
  const byInstitution = {};

  for (const job of jobs) {
    const src  = String(job.source   || "Unknown");
    const inst = String(job.college  || "Unknown");
    const type = detectPositionType(job.title);

    bySource[src]      = (bySource[src]      || 0) + 1;
    byType[type]       = (byType[type]       || 0) + 1;
    byInstitution[inst] = (byInstitution[inst] || 0) + 1;
  }

  const topSources = Object.entries(bySource)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([source, count]) => ({ source, count }));

  const topInstitutions = Object.entries(byInstitution)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([institution, count]) => ({ institution, count }));

  return {
    totalJobs: jobs.length,
    bySource,
    byType,
    topSources,
    topInstitutions,
    tenureTrackBreakdown: computeTenureTrackBreakdown(jobs),
    institutionControlBreakdown: computeInstitutionControlBreakdown(jobs, institutions),
    aiHiringBreakdown: computeAiHiringBreakdown(jobs),
  };
}

// ── Fallback template summary ─────────────────────────────────────────────────

function templateSummary(stats, prev) {
  const delta = prev ? stats.totalJobs - prev.totalJobs : 0;
  const sign  = delta >= 0 ? "+" : "";
  const topType = Object.entries(stats.byType).sort((a, b) => b[1] - a[1])[0];
  return [
    `Faculty Atlas is currently tracking ${stats.totalJobs.toLocaleString()} open faculty positions` +
      (prev ? ` — ${sign}${delta} compared to last week.` : "."),
    stats.institutionControlBreakdown.classified
      ? `Among listings matched to institution type, ${stats.institutionControlBreakdown.publicPct}% are at public institutions and ${stats.institutionControlBreakdown.privateNonprofitPct}% are at private nonprofit institutions.`
      : "",
    topType
      ? `${topType[0]} roles represent the largest category with ${topType[1].toLocaleString()} listings.`
      : "",
    stats.tenureTrackBreakdown.classified
      ? `Among positions with a known appointment track, ${stats.tenureTrackBreakdown.tenureTrackPct}% are tenure-track and ${stats.tenureTrackBreakdown.nonTenureTrackPct}% are non-tenure-track.`
      : "",
    stats.aiHiringBreakdown.related
      ? `${stats.aiHiringBreakdown.related.toLocaleString()} listings (${stats.aiHiringBreakdown.sharePct}%) explicitly reference artificial intelligence or a core AI method.`
      : "",
  ].filter(Boolean).join(" ");
}

// ── Ollama API call ───────────────────────────────────────────────────────────

function callOllama(statsForPrompt) {
  return new Promise((resolve, reject) => {
    const prompt = `You are writing a weekly digest for Faculty Atlas, a U.S. faculty job listings platform.

Write a 2-3 paragraph summary (150–200 words) of this week's faculty hiring trends. Use a professional but readable newsletter tone.

Focus on:
- Changes in total listing volume vs last week (if available)
- How public versus private nonprofit hiring compares
- What position types dominate
- The tenure-track versus non-tenure-track mix, while acknowledging unclassified listings
- Anything noteworthy or surprising in the data

Avoid: technical jargon, mentioning job IDs, phrases like "the data shows" or "according to the data", or bullet points.

Weekly data:
${JSON.stringify(statsForPrompt, null, 2)}`;

    const body = JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [{ role: "user", content: prompt }],
      stream: false,
    });

    const [hostname, port] = OLLAMA_HOST.split(":");
    const req = http.request(
      {
        hostname,
        port: Number(port) || 11434,
        path: "/api/chat",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            const text = parsed?.message?.content;
            if (text) resolve(text.trim());
            else reject(new Error(JSON.stringify(parsed)));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\nFaculty Atlas - Weekly Trends Generator");
  if (DRY_RUN) console.log("  *** DRY RUN ***");
  if (AI_BACKEND === "ollama") console.log(`  Backend: Ollama (${OLLAMA_MODEL} @ ${OLLAMA_HOST})`);
  else if (AI_BACKEND === "template") console.log("  Backend: deterministic template");
  else throw new Error(`Unsupported AI_BACKEND: ${AI_BACKEND}`);

  const payload = readJson(JOBS_PATH);
  if (!payload?.jobs?.length) { console.error("Cannot read public/jobs.json"); process.exit(1); }
  const institutionsPayload = readJson(INSTITUTIONS_PATH);
  const institutions = Array.isArray(institutionsPayload?.institutions) ? institutionsPayload.institutions : [];
  if (!institutions.length) { console.error("Cannot read data/institutions-master.json"); process.exit(1); }

  const history = readJson(HISTORY_PATH) || [];
  const weekEnd = isoWeekEnd();
  const prev    = latestPriorWeek(history, weekEnd);
  const stats   = computeStats(payload.jobs, institutions);

  console.log(`\n  Week ending : ${weekEnd}`);
  console.log(`  Total jobs  : ${stats.totalJobs.toLocaleString()}`);
  if (prev) console.log(`  vs last week: ${prev.totalJobs.toLocaleString()} (${stats.totalJobs - prev.totalJobs >= 0 ? "+" : ""}${stats.totalJobs - prev.totalJobs})`);

  // Build a compact stats subset for the narrative model.
  const statsForPrompt = {
    weekEnd,
    totalJobs: stats.totalJobs,
    previousWeekTotal: prev?.totalJobs ?? null,
    totalDelta: prev ? stats.totalJobs - prev.totalJobs : null,
    totalDeltaPct: prev ? Number(((( stats.totalJobs - prev.totalJobs) / prev.totalJobs) * 100).toFixed(1)) : null,
    topSourcesByJobs: stats.topSources.slice(0, 8),
    positionTypeBreakdown: stats.byType,
    tenureTrackBreakdown: stats.tenureTrackBreakdown,
    institutionControlBreakdown: stats.institutionControlBreakdown,
    aiHiringBreakdown: {
      ...stats.aiHiringBreakdown,
      delta: prev?.aiHiringBreakdown?.related == null ? null : stats.aiHiringBreakdown.related - prev.aiHiringBreakdown.related,
      deltaPct: prev?.aiHiringBreakdown?.related
        ? Number((((stats.aiHiringBreakdown.related - prev.aiHiringBreakdown.related) / prev.aiHiringBreakdown.related) * 100).toFixed(1))
        : null,
    },
    topInstitutions: stats.topInstitutions.slice(0, 5),
  };

  // Generate prose summary
  let summary;
  if (AI_BACKEND === "template") {
    summary = templateSummary(stats, prev);
    console.log("\n  Template summary generated.");
  } else try {
    console.log(`\n  Generating prose summary...`);
    summary = await callOllama(statsForPrompt);
    console.log("  Summary generated.");
  } catch (err) {
    console.warn(`  AI error: ${err.message} — falling back to template.`);
    summary = templateSummary(stats, prev);
  }

  // Build history entry. aiSummary is persisted here (not just in the current
  // week's output) so generate-trends-pages.js can render a permanent page for
  // every past week, not just the latest one.
  const historyEntry = {
    weekEnd,
    totalJobs: stats.totalJobs,
    bySource: stats.bySource,
    byType: stats.byType,
    tenureTrackBreakdown: stats.tenureTrackBreakdown,
    institutionControlBreakdown: stats.institutionControlBreakdown,
    aiHiringBreakdown: statsForPrompt.aiHiringBreakdown,
    topSources: stats.topSources,
    topInstitutions: stats.topInstitutions,
    aiSummary: summary,
  };

  // Avoid duplicate entries for the same weekEnd
  const updatedHistory = [
    ...history.filter((h) => h.weekEnd !== weekEnd),
    historyEntry,
  ].slice(-52); // keep 52 weeks

  // Build output
  const out = {
    weekEnd,
    generatedAt: new Date().toISOString(),
    aiSummary: summary,
    stats: {
      ...statsForPrompt,
      topSources: stats.topSources,
      topInstitutions: stats.topInstitutions,
    },
    history: updatedHistory.map((h) => ({
      weekEnd: h.weekEnd,
      totalJobs: h.totalJobs,
      tenureTrack: h.tenureTrackBreakdown?.tenureTrack ?? null,
      nonTenureTrack: h.tenureTrackBreakdown?.nonTenureTrack ?? null,
      tenureTrackPct: h.tenureTrackBreakdown?.tenureTrackPct ?? null,
      nonTenureTrackPct: h.tenureTrackBreakdown?.nonTenureTrackPct ?? null,
      publicJobs: h.institutionControlBreakdown?.public ?? null,
      privateNonprofitJobs: h.institutionControlBreakdown?.privateNonprofit ?? null,
      publicPct: h.institutionControlBreakdown?.publicPct ?? null,
      privateNonprofitPct: h.institutionControlBreakdown?.privateNonprofitPct ?? null,
      institutionControlUnknown: h.institutionControlBreakdown?.unknown ?? null,
      aiRelatedJobs: h.aiHiringBreakdown?.related ?? null,
      aiRelatedPct: h.aiHiringBreakdown?.sharePct ?? null,
      aiClassifierVersion: h.aiHiringBreakdown?.classifierVersion ?? null,
    })),
  };

  if (DRY_RUN) {
    console.log("\n-- DRY RUN output preview --");
    console.log(`  Summary: ${summary.slice(0, 120)}...`);
    console.log("  (No files written)");
    return;
  }

  for (const p of OUT_PATHS) writeJson(p, out);
  writeJson(HISTORY_PATH, updatedHistory);

  console.log("\n  Files written:");
  for (const p of OUT_PATHS) console.log(`    ${path.relative(ROOT, p)}`);
  console.log(`    ${path.relative(ROOT, HISTORY_PATH)}`);
  console.log("");
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
