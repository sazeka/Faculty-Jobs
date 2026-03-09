#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadCampusConfigs } from "./lib/campus-config.js";
import { canonicalizeUrl, clean, inferPlatformFromUrl, normalizeNameKey } from "./lib/url-normalization.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const OVERRIDES_PATH = path.join(ROOT, "data", "career-url-overrides.json");
const CRITICAL_PATH = path.join(ROOT, "data", "critical-schools.json");
const OUT_VERIFY_PATH = path.join(ROOT, "generated", "career-link-verification.json");
const OUT_STATUS_PATH = path.join(ROOT, "generated", "institution-link-status.json");
const OUT_QUARANTINE_PATH = path.join(ROOT, "generated", "career-link-quarantine.json");
const HEALTH_STATE_PATH = path.join(ROOT, "generated", "career-link-health-state.json");

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

function readJsonOrNull(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function buildOverridesMap() {
  const data = readJsonOrNull(OVERRIDES_PATH);
  const rows = Array.isArray(data?.overrides) ? data.overrides : [];
  const map = new Map();
  for (const row of rows) {
    const name = clean(row?.name);
    if (!name) continue;
    map.set(normalizeNameKey(name), {
      name,
      homepage_url: canonicalizeUrl(row?.homepage_url),
      career_url: canonicalizeUrl(row?.career_url),
      platform_type: clean(row?.platform_type) || null,
      notes: clean(row?.notes) || null,
    });
  }
  return map;
}

function loadCriticalSchools() {
  const data = readJsonOrNull(CRITICAL_PATH);
  const rows = Array.isArray(data?.schools) ? data.schools : [];
  return new Set(rows.map((s) => normalizeNameKey(s)).filter(Boolean));
}

function withTimeout(ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, clear: () => clearTimeout(t) };
}

async function verifyUrl(url, timeoutMs) {
  const canonical = canonicalizeUrl(url);
  if (!canonical) {
    return {
      status: "invalid",
      http_status: null,
      final_url: null,
      error: "invalid_url",
      canonical_url: null,
    };
  }

  const methods = ["HEAD", "GET"];
  for (const method of methods) {
    const timer = withTimeout(timeoutMs);
    try {
      const res = await fetch(canonical, {
        method,
        redirect: "follow",
        signal: timer.signal,
        headers: {
          "user-agent": "faculty-jobs-link-check/1.0",
          "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });
      timer.clear();

      if (res.status === 405 && method === "HEAD") {
        continue;
      }

      return {
        status: res.status >= 400 ? "broken" : "healthy",
        http_status: res.status,
        final_url: canonicalizeUrl(res.url) || res.url,
        error: null,
        canonical_url: canonical,
      };
    } catch (e) {
      timer.clear();
      if (method === "HEAD") continue;
      try {
        const fallback = await fetch(canonical, { method: "GET", redirect: "follow" });
        return {
          status: fallback.status >= 400 ? "broken" : "healthy",
          http_status: fallback.status,
          final_url: canonicalizeUrl(fallback.url) || fallback.url,
          error: null,
          canonical_url: canonical,
        };
      } catch (fallbackError) {
        const causeCode = fallbackError?.cause?.code || e?.cause?.code || null;
        const errMsg = clean(fallbackError?.message || e?.message || String(fallbackError || e));
        return {
          status: "broken",
          http_status: null,
          final_url: null,
          error: causeCode ? `${errMsg} (${causeCode})` : errMsg,
          canonical_url: canonical,
        };
      }
    }
  }

  return {
    status: "broken",
    http_status: null,
    final_url: null,
    error: "unreachable",
    canonical_url: canonical,
  };
}

function mergeInstitutionRows(configured, overridesMap) {
  const rows = [];
  for (const c of configured) {
    const key = normalizeNameKey(c.name);
    const ov = overridesMap.get(key);
    const homepage_url = canonicalizeUrl(ov?.homepage_url || c.url);
    const career_url = canonicalizeUrl(ov?.career_url || c.url);
    rows.push({
      name: c.name,
      platform_type: clean(ov?.platform_type || c.platform_type || inferPlatformFromUrl(career_url) || "generic"),
      homepage_url,
      career_url,
      override_applied: Boolean(ov),
      override_notes: ov?.notes || null,
    });
  }
  return rows;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const timeoutMs = Math.max(2000, Number(args.timeout || 12000));
  const concurrency = Math.max(1, Number(args.concurrency || 12));
  const quarantineThreshold = Math.max(1, Number(args["quarantine-threshold"] || 2));
  const failOnBroken = args["fail-on-broken"] === true;
  const criticalOnly = args["critical-only"] === true;

  const overridesMap = buildOverridesMap();
  const critical = loadCriticalSchools();
  const configured = loadCampusConfigs();
  const merged = mergeInstitutionRows(configured, overridesMap);
  const inputs = criticalOnly ? merged.filter((x) => critical.has(normalizeNameKey(x.name))) : merged;

  const healthState = readJsonOrNull(HEALTH_STATE_PATH);
  const previous = new Map(Array.isArray(healthState?.institutions)
    ? healthState.institutions.map((r) => [normalizeNameKey(r.name), r])
    : []);

  const checkedAt = new Date().toISOString();
  const results = [];
  let idx = 0;

  async function worker() {
    while (idx < inputs.length) {
      const current = inputs[idx++];
      const v = await verifyUrl(current.career_url, timeoutMs);
      const key = normalizeNameKey(current.name);
      const prev = previous.get(key);
      const prevFails = Number(prev?.consecutive_failures || 0);
      const fails = v.status === "healthy" ? 0 : prevFails + 1;
      const quarantined = fails >= quarantineThreshold;

      results.push({
        ...current,
        checked_at: checkedAt,
        last_verified_at: checkedAt,
        verification_status: quarantined ? "quarantined_broken_link" : v.status,
        http_status: v.http_status,
        final_url: v.final_url,
        error: v.error,
        consecutive_failures: fails,
        quarantined,
      });
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  results.sort((a, b) => a.name.localeCompare(b.name));

  const broken = results.filter((r) => r.verification_status !== "healthy");
  const quarantined = results.filter((r) => r.quarantined);

  const payload = {
    generatedAt: checkedAt,
    settings: { timeoutMs, concurrency, quarantineThreshold, criticalOnly },
    counts: {
      checked: results.length,
      healthy: results.filter((r) => r.verification_status === "healthy").length,
      broken: broken.length,
      quarantined: quarantined.length,
    },
    institutions: results,
  };

  const statusPayload = {
    generatedAt: checkedAt,
    institutions: results.map((r) => ({
      name: r.name,
      career_url: r.career_url,
      homepage_url: r.homepage_url,
      last_verified_at: r.last_verified_at,
      verification_status: r.verification_status,
      http_status: r.http_status,
      final_url: r.final_url,
      consecutive_failures: r.consecutive_failures,
      quarantined: r.quarantined,
    })),
  };

  const quarantinePayload = {
    generatedAt: checkedAt,
    threshold: quarantineThreshold,
    institutions: quarantined.map((r) => ({
      name: r.name,
      career_url: r.career_url,
      homepage_url: r.homepage_url,
      verification_status: r.verification_status,
      consecutive_failures: r.consecutive_failures,
      http_status: r.http_status,
      error: r.error,
      checked_at: r.checked_at,
    })),
  };

  const healthPayload = {
    generatedAt: checkedAt,
    institutions: results.map((r) => ({
      name: r.name,
      consecutive_failures: r.consecutive_failures,
      verification_status: r.verification_status,
      checked_at: r.checked_at,
    })),
  };

  for (const filePath of [OUT_VERIFY_PATH, OUT_STATUS_PATH, OUT_QUARANTINE_PATH, HEALTH_STATE_PATH]) {
    ensureDir(filePath);
  }
  fs.writeFileSync(OUT_VERIFY_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.writeFileSync(OUT_STATUS_PATH, `${JSON.stringify(statusPayload, null, 2)}\n`, "utf8");
  fs.writeFileSync(OUT_QUARANTINE_PATH, `${JSON.stringify(quarantinePayload, null, 2)}\n`, "utf8");
  fs.writeFileSync(HEALTH_STATE_PATH, `${JSON.stringify(healthPayload, null, 2)}\n`, "utf8");

  console.log(`Checked ${payload.counts.checked} institution career URLs`);
  console.log(`Healthy: ${payload.counts.healthy}`);
  console.log(`Broken: ${payload.counts.broken}`);
  console.log(`Quarantined: ${payload.counts.quarantined}`);
  console.log(`Wrote ${path.relative(ROOT, OUT_VERIFY_PATH)}`);

  if (failOnBroken && broken.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
