// scripts/scrape-to-json.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { scrapeAllJobsStandalone, callLocalSummarizer, getSystemGroup } from "../server.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function countBySource(data) {
  const out = {};
  for (const j of data?.jobs || []) {
    const s = String(j?.source || "").trim();
    if (!s) continue;
    out[s] = (out[s] || 0) + 1;
  }
  return out;
}

function shouldBlockOverwrite(newData, prevData, allowlistRaw) {
  if (!prevData || !Array.isArray(prevData.jobs) || prevData.jobs.length === 0) return { block: false, reasons: [] };
  if (!newData || !Array.isArray(newData.jobs)) return { block: false, reasons: [] };

  const allow = String(allowlistRaw || "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  if (allow.length === 0) return { block: false, reasons: [] };

  const prevBy = countBySource(prevData);
  const nextBy = countBySource(newData);

  const monitored = Object.keys(prevBy).filter((k) => allow.includes(String(k).toUpperCase()));
  if (monitored.length === 0) return { block: false, reasons: [] };

  const reasons = [];
  const prevTotal = monitored.reduce((n, s) => n + (prevBy[s] || 0), 0);
  const nextTotal = monitored.reduce((n, s) => n + (nextBy[s] || 0), 0);

  if (prevTotal >= 100 && nextTotal < Math.floor(prevTotal * 0.5)) {
    reasons.push(`allowlisted total dropped from ${prevTotal} to ${nextTotal}`);
  }

  for (const s of monitored) {
    const p = prevBy[s] || 0;
    const n = nextBy[s] || 0;
    if (p >= 50 && n === 0) {
      reasons.push(`${s} dropped from ${p} to 0`);
    }
  }

  return { block: reasons.length > 0, reasons };
}

(async () => {
  const data = await scrapeAllJobsStandalone(); // { scrapedAt, count, jobs }

  // Local GPU LLM summarization (offline)
  if (data && Array.isArray(data.jobs)) {
    console.log(`📡 Calling local summarizer for ${data.jobs.length} jobs`);
    data.jobs = await callLocalSummarizer(data.jobs);
    for (const job of data.jobs) {
      job.systemGroup = getSystemGroup(job.source) || null;
    }
    data.count = data.jobs.length;
  }

  const targets = [
    path.join(__dirname, "..", "docs", "jobs.json"),
    path.join(__dirname, "..", "public", "jobs.json"),
  ];

  const previousPath = path.join(__dirname, "..", "public", "jobs.json");
  let previousData = null;
  try {
    if (fs.existsSync(previousPath)) {
      previousData = JSON.parse(fs.readFileSync(previousPath, "utf-8"));
    }
  } catch (e) {
    console.warn(`⚠️  Failed to read previous snapshot: ${e?.message || e}`);
  }

  const allowlist = process.env.CAMPUS_ALLOWLIST || "";
  const forceWrite = process.env.FORCE_WRITE_ON_DROP === "1";
  const guard = shouldBlockOverwrite(data, previousData, allowlist);
  if (guard.block && !forceWrite) {
    console.warn("⚠️  Snapshot guard blocked overwrite (likely anti-bot/blocked run).");
    for (const r of guard.reasons) console.warn(`   - ${r}`);
    console.warn("⚠️  Existing jobs.json files were preserved.");
    console.warn("   Set FORCE_WRITE_ON_DROP=1 to override.");
    return;
  }

  for (const outPath of targets) {
    fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
    console.log(`✅ Wrote ${outPath} (${data.count} jobs)`);
  }
})();
