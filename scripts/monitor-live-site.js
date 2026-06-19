#!/usr/bin/env node
/**
 * monitor-live-site.js
 *
 * Verifies the health of the live GitHub Pages deployment.
 * Exits 0 if all critical checks pass, 1 if any fail.
 *
 * Usage:
 *   node scripts/monitor-live-site.js [--base-url <url>] [--max-age-days <n>] [--min-jobs <n>]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const REPORT_PATH = path.join(ROOT, "generated", "live-site-health.json");

// ── CLI args ──────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) { out[key] = true; continue; }
    out[key] = next;
    i++;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
// The site moved to the facultyatlas.org custom domain; the old
// sazeka.github.io/Faculty-Jobs URL now 301-redirects there, which breaks
// asset checks (assets resolve against the redirected origin and 404).
const BASE_URL = String(args["base-url"] || "https://www.facultyatlas.org").replace(/\/$/, "");
const MAX_AGE_DAYS = Number(args["max-age-days"] || 14);
const WARN_AGE_DAYS = Number(args["warn-age-days"] || 7);
const MIN_JOBS = Number(args["min-jobs"] || 500);
const CHUNK_SAMPLE_SIZE = 3;
const FETCH_TIMEOUT_MS = 15_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

const PASS = "PASS";
const WARN = "WARN";
const FAIL = "FAIL";

function result(status, name, detail = "") {
  const icon = status === PASS ? "✅" : status === WARN ? "⚠️ " : "❌";
  console.log(`  ${icon} [${status}] ${name}${detail ? `: ${detail}` : ""}`);
  return { status, name, detail };
}

async function fetchWithTimeout(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } catch (err) {
    throw new Error(err?.name === "AbortError" ? `Timed out after ${FETCH_TIMEOUT_MS}ms` : (err?.message || String(err)));
  } finally {
    clearTimeout(t);
  }
}

async function fetchJson(url) {
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  try {
    return { res, data: JSON.parse(text) };
  } catch {
    const preview = text.slice(0, 80).replace(/\s+/g, " ");
    throw new Error(`Non-JSON response (preview: "${preview}")`);
  }
}

function sample(arr, n) {
  const copy = arr.slice();
  const out = [];
  while (out.length < n && copy.length > 0) {
    const i = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(i, 1)[0]);
  }
  return out;
}

function ensureDir(p) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
}

// ── Checks ────────────────────────────────────────────────────────────────────

async function checkSiteRoot() {
  try {
    const res = await fetchWithTimeout(`${BASE_URL}/`);
    if (res.ok) return result(PASS, "Site root reachable", `HTTP ${res.status}`);
    return result(FAIL, "Site root reachable", `HTTP ${res.status}`);
  } catch (err) {
    return result(FAIL, "Site root reachable", err.message);
  }
}

async function checkIndexAssets() {
  const results = [];
  let html;
  try {
    const res = await fetchWithTimeout(`${BASE_URL}/`);
    html = await res.text();
  } catch (err) {
    results.push(result(FAIL, "index.html assets", `Could not fetch index.html: ${err.message}`));
    return results;
  }

  const jsMatch = html.match(/src="([^"]+\.js)"/);
  const cssMatch = html.match(/href="([^"]+\.css)"/);

  for (const [label, match] of [["JS bundle", jsMatch], ["CSS bundle", cssMatch]]) {
    if (!match) {
      results.push(result(FAIL, `${label} reference found`, "No match in index.html"));
      continue;
    }
    const origin = new URL(BASE_URL).origin;
    const assetUrl = match[1].startsWith("http") ? match[1] : `${origin}${match[1].startsWith("/") ? "" : "/"}${match[1]}`;
    try {
      const res = await fetchWithTimeout(assetUrl);
      results.push(res.ok
        ? result(PASS, `${label} loads`, `${assetUrl.split("/").pop()} → HTTP ${res.status}`)
        : result(FAIL, `${label} loads`, `HTTP ${res.status}`));
    } catch (err) {
      results.push(result(FAIL, `${label} loads`, err.message));
    }
  }
  return results;
}

async function checkManifest() {
  try {
    const { data: manifest } = await fetchJson(`${BASE_URL}/data/jobs-manifest.json`);
    const chunks = Array.isArray(manifest?.chunks) ? manifest.chunks : [];
    if (chunks.length === 0) return [result(FAIL, "Manifest valid", "No chunks listed")];

    const totalJobs = chunks.reduce((s, c) => s + (c.count || 0), 0);
    return [
      result(PASS, "Manifest loads", `${chunks.length} chunks declared`),
      result(totalJobs >= MIN_JOBS ? PASS : FAIL, "Job count meets minimum",
        `${totalJobs.toLocaleString()} jobs (min: ${MIN_JOBS.toLocaleString()})`),
    ];
  } catch (err) {
    return [result(FAIL, "Manifest loads", err.message)];
  }
}

async function checkFreshness() {
  try {
    const { data: manifest } = await fetchJson(`${BASE_URL}/data/jobs-manifest.json`);
    const scrapedAt = manifest?.scrapedAt;
    if (!scrapedAt) return result(WARN, "Data freshness", "scrapedAt missing from manifest");

    const ageMs = Date.now() - new Date(scrapedAt).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    const label = `${ageDays.toFixed(1)} days old (scraped ${new Date(scrapedAt).toLocaleDateString()})`;

    if (ageDays > MAX_AGE_DAYS) return result(FAIL, "Data freshness", label);
    if (ageDays > WARN_AGE_DAYS) return result(WARN, "Data freshness", label);
    return result(PASS, "Data freshness", label);
  } catch (err) {
    return result(FAIL, "Data freshness", err.message);
  }
}

async function checkChunkSample(manifest) {
  const chunks = Array.isArray(manifest?.chunks) ? manifest.chunks : [];
  if (chunks.length === 0) return [result(FAIL, "Chunk spot-check", "No chunks to sample")];

  const sampled = sample(chunks, Math.min(CHUNK_SAMPLE_SIZE, chunks.length));
  const results = [];

  for (const chunk of sampled) {
    const url = `${BASE_URL}/data/${chunk.path}`;
    try {
      const { data } = await fetchJson(url);
      const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
      if (jobs.length === 0 && chunk.count > 0) {
        results.push(result(WARN, `Chunk ${chunk.id}`, `Empty jobs array but manifest says ${chunk.count}`));
      } else {
        results.push(result(PASS, `Chunk ${chunk.id}`, `${jobs.length} jobs`));
      }
    } catch (err) {
      results.push(result(FAIL, `Chunk ${chunk.id}`, err.message));
    }
  }
  return results;
}

async function checkCollegeCoords() {
  try {
    const { data } = await fetchJson(`${BASE_URL}/college-coords.json`);
    const count = data?.colleges ? Object.keys(data.colleges).length : 0;
    return count > 0
      ? result(PASS, "College coordinates", `${count.toLocaleString()} entries`)
      : result(WARN, "College coordinates", "File loaded but no entries");
  } catch (err) {
    return result(WARN, "College coordinates", `${err.message} (map may fall back to state centroids)`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🔍 Faculty Atlas — Live Site Health Check`);
  console.log(`   Target: ${BASE_URL}`);
  console.log(`   Freshness limit: warn >${WARN_AGE_DAYS}d, fail >${MAX_AGE_DAYS}d`);
  console.log(`   Min job count: ${MIN_JOBS.toLocaleString()}\n`);

  const allResults = [];
  const startMs = Date.now();

  // 1. Site root
  console.log("── Availability ─────────────────────────────");
  allResults.push(await checkSiteRoot());

  // 2. Assets referenced in index.html
  console.log("\n── Assets ───────────────────────────────────");
  allResults.push(...await checkIndexAssets());

  // 3. Manifest + job count
  console.log("\n── Data ─────────────────────────────────────");
  const manifestResults = await checkManifest();
  allResults.push(...manifestResults);

  // 4. Freshness
  allResults.push(await checkFreshness());

  // 5. Chunk spot-check (reuse manifest if we got it)
  let manifest = null;
  try {
    const r = await fetchJson(`${BASE_URL}/data/jobs-manifest.json`);
    manifest = r.data;
  } catch { /* already reported above */ }

  console.log("\n── Chunk spot-check ─────────────────────────");
  allResults.push(...await checkChunkSample(manifest));

  // 6. College coordinates
  console.log("\n── Map data ─────────────────────────────────");
  allResults.push(await checkCollegeCoords());

  // ── Summary ──────────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  const counts = { PASS: 0, WARN: 0, FAIL: 0 };
  for (const r of allResults) counts[r.status] = (counts[r.status] || 0) + 1;
  const overallStatus = counts.FAIL > 0 ? FAIL : counts.WARN > 0 ? WARN : PASS;
  const overallIcon = overallStatus === PASS ? "✅" : overallStatus === WARN ? "⚠️ " : "❌";

  console.log(`\n─────────────────────────────────────────────`);
  console.log(`${overallIcon} Overall: ${overallStatus}  (${counts.PASS} passed, ${counts.WARN} warned, ${counts.FAIL} failed) — ${elapsed}s`);

  // ── Write report ──────────────────────────────────────────────────────────
  const report = {
    checkedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    overallStatus,
    elapsed: `${elapsed}s`,
    counts,
    checks: allResults,
  };
  try {
    ensureDir(REPORT_PATH);
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");
    console.log(`   Report written to generated/live-site-health.json\n`);
  } catch (err) {
    console.warn(`   Could not write report: ${err.message}\n`);
  }

  process.exit(overallStatus === FAIL ? 1 : 0);
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
