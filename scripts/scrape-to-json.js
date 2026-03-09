// scripts/scrape-to-json.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import { scrapeAllJobsStandalone, callLocalSummarizer, getSystemGroup } from "../server.js";
import { canonicalizeUrl } from "./lib/url-normalization.js";

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

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeKeyPart(value) {
  return clean(value).toLowerCase();
}

function sha1Hex(value) {
  return createHash("sha1").update(String(value || "")).digest("hex");
}

function addCanonicalIds(data) {
  if (!data || !Array.isArray(data.jobs)) return { data, assigned: 0 };

  let assigned = 0;
  const jobs = data.jobs.map((job) => {
    const title = normalizeKeyPart(job?.titleClean || job?.title || "");
    const college = normalizeKeyPart(job?.college || "");
    const dept = normalizeKeyPart(job?.department || "");
    const state = normalizeKeyPart(job?.state || job?.source || "");
    const source = normalizeKeyPart(job?.source || "");
    const url = normalizeKeyPart(job?.url || "");

    const canonicalGroupId = `grp_${sha1Hex([title, college, dept, state].join("|")).slice(0, 16)}`;
    const canonicalJobId = `job_${sha1Hex([canonicalGroupId, source, url].join("|")).slice(0, 16)}`;

    assigned += 1;
    return {
      ...job,
      canonicalGroupId,
      canonicalJobId,
    };
  });

  return {
    data: { ...data, jobs },
    assigned,
  };
}

function canonicalizeJobUrls(data) {
  if (!data || !Array.isArray(data.jobs)) return { data, changed: 0, removedInvalid: 0 };

  const out = [];
  const seen = new Set();
  let changed = 0;
  let removedInvalid = 0;

  for (const job of data.jobs) {
    const current = job?.url || null;
    const next = canonicalizeUrl(current);
    if (!next) {
      removedInvalid += 1;
      continue;
    }
    if (next !== current) changed += 1;
    if (seen.has(next)) continue;
    seen.add(next);
    out.push({ ...job, url: next });
  }

  return {
    data: { ...data, jobs: out, count: out.length },
    changed,
    removedInvalid,
  };
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

  const canonicalized = canonicalizeJobUrls(data);
  data = canonicalized.data;
  if (canonicalized.changed > 0 || canonicalized.removedInvalid > 0) {
    console.log(
      `🔗 Canonicalized job URLs: ${canonicalized.changed} updated, ${canonicalized.removedInvalid} invalid removed`
    );
  }

  const canonicalIds = addCanonicalIds(data);
  data = canonicalIds.data;
  if (canonicalIds.assigned > 0) {
    console.log(`🧬 Assigned canonical IDs for ${canonicalIds.assigned} jobs`);
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
