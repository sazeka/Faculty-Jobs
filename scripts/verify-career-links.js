#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";
import { loadCampusConfigs } from "./lib/campus-config.js";
import { canonicalizeUrl, clean, inferPlatformFromUrl, normalizeNameKey } from "./lib/url-normalization.js";

// Same UA/viewport/locale the real scrapers use (server.js scrapeAllJobsStandalone,
// scripts/test-overrides.js) so the fallback browser looks like the same client
// that already successfully scrapes these sites, not a second, different bot.
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121 Safari/537.36";

// Phrases that show up on the interstitial/challenge page itself rather than on
// real site content -- i.e. even a JS-executing browser got stopped short of the
// actual career page. Kept intentionally narrow (lowercased substring match) so
// we don't misclassify a legitimate page that merely mentions "captcha" in a
// footer or FAQ.
const BOT_CHALLENGE_MARKERS = [
  "checking your browser before accessing",
  "just a moment...",
  "attention required! | cloudflare",
  "please verify you are a human",
  "verify you are human",
  "access denied",
  "request unsuccessful. incapsula",
  "your browser is out of date", // Paylocity's non-JS fallback shell
];

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

function detectBotChallenge(text) {
  const lower = clean(text).toLowerCase();
  if (!lower) return false;
  return BOT_CHALLENGE_MARKERS.some((marker) => lower.includes(marker));
}

// Slow-path re-check for anything the plain fetch() above called broken. A
// meaningful fraction of "broken" links are nothing of the sort -- Paylocity,
// ADP, and several campus ATS integrations only render their real content for
// a JS-executing client, and some sites (Cloudflare-fronted, or with an
// incomplete TLS intermediate chain) 403 / TLS-fail a bare fetch() while a real
// browser loads fine. Reusing a real headless browser here, same as the actual
// scrapers do, closes that gap instead of quarantining live links.
async function verifyUrlWithBrowser(context, url, timeoutMs) {
  const canonical = canonicalizeUrl(url);
  if (!canonical) {
    return { status: "invalid", http_status: null, final_url: null, error: "invalid_url", bot_blocked: false };
  }

  const page = await context.newPage();
  try {
    const response = await page.goto(canonical, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    // Give client-side rendering (Paylocity/ADP/Workday-style SPAs) a moment to
    // paint before we read the DOM -- domcontentloaded alone often fires before
    // the job list itself has rendered.
    await page.waitForTimeout(1500).catch(() => {});

    const httpStatus = response ? response.status() : null;
    const bodyText = await page.evaluate(() => document.body?.innerText || "").catch(() => "");
    const title = await page.title().catch(() => "");
    const botBlocked = detectBotChallenge(`${title} ${bodyText.slice(0, 2000)}`);

    const healthy = httpStatus !== null && httpStatus < 400 && !botBlocked;
    return {
      status: healthy ? "healthy" : "broken",
      http_status: httpStatus,
      final_url: canonicalizeUrl(page.url()) || page.url(),
      error: botBlocked ? "bot_challenge_page" : healthy ? null : `http_${httpStatus ?? "unknown"}`,
      bot_blocked: botBlocked,
    };
  } catch (e) {
    const causeCode = e?.cause?.code || null;
    const errMsg = clean(e?.message || String(e));
    return {
      status: "broken",
      http_status: null,
      final_url: null,
      error: causeCode ? `${errMsg} (${causeCode})` : errMsg,
      bot_blocked: false,
    };
  } finally {
    await page.close().catch(() => {});
  }
}

function mergeInstitutionRows(configured, overridesMap) {
  const rows = [];
  for (const c of configured) {
    const key = normalizeNameKey(c.name);
    const ov = overridesMap.get(key);
    const homepage_url = canonicalizeUrl(ov?.homepage_url || c.career_url);
    const career_url = canonicalizeUrl(ov?.career_url || c.career_url);
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
  const browserFallbackEnabled = args["browser-fallback"] !== false && !args["no-browser-fallback"];
  const browserConcurrency = Math.max(1, Number(args["browser-concurrency"] || 6));
  const browserTimeoutMs = Math.max(5000, Number(args["browser-timeout"] || 20000));

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

  // Pass 1: cheap fetch() check for everyone.
  const verdicts = new Map(); // normalizedName -> verification result
  {
    let idx = 0;
    async function fetchWorker() {
      while (idx < inputs.length) {
        const current = inputs[idx++];
        const v = await verifyUrl(current.career_url, timeoutMs);
        verdicts.set(normalizeNameKey(current.name), { ...v, verified_via: "fetch" });
      }
    }
    await Promise.all(Array.from({ length: concurrency }, () => fetchWorker()));
  }

  // Pass 2: anything fetch() called broken gets a second look from a real
  // headless browser, since a meaningful share of those are JS-gated ATS pages
  // or bot-protection false positives, not actually dead (see verify-career-links
  // history / the 2026-08-11 career-link-health repair round). Browser is only
  // launched if there's actually work for it, and never blocks pass 1's speed.
  const brokenAfterFetch = inputs.filter((c) => verdicts.get(normalizeNameKey(c.name))?.status !== "healthy");
  let rescuedByBrowser = 0;
  let botBlockedCount = 0;

  if (browserFallbackEnabled && brokenAfterFetch.length > 0) {
    let browser = null;
    try {
      // --disable-blink-features=AutomationControlled hides the navigator.webdriver
      // flag that Chromium sets by default in headless mode -- some WAFs (confirmed:
      // interviewexchange.com) 403 on that flag alone with no CAPTCHA/challenge page
      // at all, so it looks identical to a genuinely dead link without this.
      browser = await chromium.launch({ headless: true, args: ["--disable-blink-features=AutomationControlled"] });
    } catch (e) {
      console.warn(
        `⚠️  Browser fallback disabled: could not launch Chromium (${clean(e?.message || e)}). ` +
          `Run "npm run install:browsers" if this is unexpected. Falling back to fetch()-only results for ${brokenAfterFetch.length} link(s).`
      );
    }

    if (browser) {
      try {
        const poolSize = Math.min(browserConcurrency, brokenAfterFetch.length);
        const contexts = await Promise.all(
          Array.from({ length: poolSize }, () =>
            browser.newContext({
              userAgent: BROWSER_USER_AGENT,
              viewport: { width: 1280, height: 800 },
              locale: "en-US",
              ignoreHTTPSErrors: true, // several sites have an incomplete intermediate cert chain that Node's fetch() rejects but real browsers tolerate fine
            })
          )
        );

        let bIdx = 0;
        async function browserWorker(context) {
          while (bIdx < brokenAfterFetch.length) {
            const current = brokenAfterFetch[bIdx++];
            const key = normalizeNameKey(current.name);
            const fetchVerdict = verdicts.get(key);
            const bv = await verifyUrlWithBrowser(context, current.career_url, browserTimeoutMs);
            if (bv.status === "healthy") rescuedByBrowser += 1;
            if (bv.bot_blocked) botBlockedCount += 1;
            verdicts.set(key, {
              ...bv,
              verified_via: "browser_fallback",
              fetch_error: fetchVerdict?.error || null,
              fetch_http_status: fetchVerdict?.http_status ?? null,
            });
          }
        }
        await Promise.all(contexts.map((ctx) => browserWorker(ctx)));
        await Promise.all(contexts.map((ctx) => ctx.close().catch(() => {})));
      } finally {
        await browser.close().catch(() => {});
      }
    }
  }

  // Pass 3: combine into final per-institution records, using whichever
  // verdict is most authoritative (browser_fallback's if it ran, else fetch's).
  const results = [];
  for (const current of inputs) {
    const key = normalizeNameKey(current.name);
    const v = verdicts.get(key);
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
      verified_via: v.verified_via,
      bot_blocked: Boolean(v.bot_blocked),
      consecutive_failures: fails,
      quarantined,
    });
  }

  results.sort((a, b) => a.name.localeCompare(b.name));

  const broken = results.filter((r) => r.verification_status !== "healthy");
  const quarantined = results.filter((r) => r.quarantined);

  const payload = {
    generatedAt: checkedAt,
    settings: {
      timeoutMs,
      concurrency,
      quarantineThreshold,
      criticalOnly,
      browserFallbackEnabled,
      browserConcurrency,
      browserTimeoutMs,
    },
    counts: {
      checked: results.length,
      healthy: results.filter((r) => r.verification_status === "healthy").length,
      broken: broken.length,
      quarantined: quarantined.length,
      rescuedByBrowser,
      botBlocked: botBlockedCount,
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
      verified_via: r.verified_via,
      bot_blocked: r.bot_blocked,
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
      verified_via: r.verified_via,
      bot_blocked: r.bot_blocked,
      checked_at: r.checked_at,
    })),
  };

  const healthPayload = {
    generatedAt: checkedAt,
    institutions: results.map((r) => ({
      name: r.name,
      consecutive_failures: r.consecutive_failures,
      verification_status: r.verification_status,
      verified_via: r.verified_via,
      bot_blocked: r.bot_blocked,
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
  if (browserFallbackEnabled) {
    console.log(`Rescued by browser fallback: ${rescuedByBrowser} (fetch() called these broken; a real browser did not)`);
    console.log(`Still broken behind a bot challenge even in-browser: ${botBlockedCount}`);
  }
  console.log(`Wrote ${path.relative(ROOT, OUT_VERIFY_PATH)}`);

  if (failOnBroken && broken.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
