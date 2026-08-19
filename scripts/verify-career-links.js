#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";
import { loadCampusConfigs } from "./lib/campus-config.js";
import {
  BOT_BLOCKED_STATUS,
  hasBotChallengeUrl,
  hasMeaningfulTimedOutPage,
  isHardVerificationFailure,
  nextConsecutiveFailures,
} from "./lib/link-verdict.js";
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
  "your access to this site has been limited",
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

      const botBlocked = hasBotChallengeUrl(res.url);
      return {
        status: botBlocked ? BOT_BLOCKED_STATUS : res.status >= 400 ? "broken" : "healthy",
        http_status: res.status,
        final_url: canonicalizeUrl(res.url) || res.url,
        error: botBlocked ? "bot_challenge_redirect" : null,
        canonical_url: canonical,
      };
    } catch (e) {
      timer.clear();
      if (method === "HEAD") continue;
      const fallbackTimer = withTimeout(timeoutMs);
      try {
        const fallback = await fetch(canonical, {
          method: "GET",
          redirect: "follow",
          signal: fallbackTimer.signal,
        });
        fallbackTimer.clear();
        const botBlocked = hasBotChallengeUrl(fallback.url);
        return {
          status: botBlocked ? BOT_BLOCKED_STATUS : fallback.status >= 400 ? "broken" : "healthy",
          http_status: fallback.status,
          final_url: canonicalizeUrl(fallback.url) || fallback.url,
          error: botBlocked ? "bot_challenge_redirect" : null,
          canonical_url: canonical,
        };
      } catch (fallbackError) {
        fallbackTimer.clear();
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

// Collapses a hostname to its registrable base domain so subdomain siblings on
// the same ATS (dean.interviewexchange.com, farmingdale.interviewexchange.com,
// esc.interviewexchange.com are all interviewexchange.com underneath) are
// recognized as sharing the same upstream infra/WAF, not treated as unrelated
// hosts. Deliberately simple (last two labels) rather than a full public-suffix
// lookup -- every ATS domain seen in this codebase (interviewexchange.com,
// myworkdayjobs.com, schooljobs.com, paylocity.com, adp.com, ...) is a plain
// .com/.net, so this doesn't need to handle multi-part TLDs like co.uk.
function baseDomain(hostname) {
  const parts = clean(hostname).toLowerCase().split(".").filter(Boolean);
  return parts.length <= 2 ? parts.join(".") : parts.slice(-2).join(".");
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
    const bodyText = await page
      .evaluate(() => `${document.body?.innerText || ""} ${document.body?.textContent || ""}`)
      .catch(() => "");
    const title = await page.title().catch(() => "");
    let knownAtsAutomationBlock = false;
    try {
      const host = new URL(page.url()).hostname;
      knownAtsAutomationBlock =
        (httpStatus === 403 && baseDomain(host) === "interviewexchange.com") ||
        // NYU's CDN alternates between a `?challenge=` response and a bare 405
        // for this official faculty-search page when it detects automation.
        // A normal interactive session reaches the same URL and the dedicated
        // NYU scraper handles its Interfolio listings.
        (httpStatus === 405 && /(^|\.)nyu\.edu$/i.test(host));
    } catch {
      /* page.url() can be non-HTTP after a failed navigation */
    }
    const botBlocked =
      hasBotChallengeUrl(page.url()) ||
      detectBotChallenge(`${title} ${bodyText.slice(0, 2000)}`) ||
      knownAtsAutomationBlock;

    const healthy = httpStatus !== null && httpStatus < 400 && !botBlocked;
    return {
      status: botBlocked ? BOT_BLOCKED_STATUS : healthy ? "healthy" : "broken",
      http_status: httpStatus,
      final_url: canonicalizeUrl(page.url()) || page.url(),
      error: botBlocked ? "bot_challenge_page" : healthy ? null : `http_${httpStatus ?? "unknown"}`,
      bot_blocked: botBlocked,
    };
  } catch (e) {
    // `page.goto(..., waitUntil: "domcontentloaded")` can time out after the
    // server has already returned and rendered a meaningful page. This is
    // common on otherwise-live college sites with a stuck analytics/widget
    // resource (Alverno, Blackfeet, and BJU all reproduced it in CI). For a
    // link-health check, a real rendered document is authoritative even when
    // the load lifecycle never settles.
    const bodyText = await page.evaluate(() => document.body?.innerText || "").catch(() => "");
    const title = await page.title().catch(() => "");
    const finalUrl = page.url();
    const botBlocked =
      hasBotChallengeUrl(finalUrl) || detectBotChallenge(`${title} ${bodyText.slice(0, 2000)}`);
    if (botBlocked || hasMeaningfulTimedOutPage(finalUrl, title, bodyText)) {
      return {
        status: botBlocked ? BOT_BLOCKED_STATUS : "healthy",
        http_status: null,
        final_url: canonicalizeUrl(finalUrl) || finalUrl,
        error: botBlocked ? "bot_challenge_page" : "navigation_timeout_after_render",
        bot_blocked: botBlocked,
      };
    }
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
  const included = new Set();
  for (const c of configured) {
    const key = normalizeNameKey(c.name);
    included.add(key);
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
  // System-wide scrapers (CSU, USG, TCSG) intentionally omit many individual
  // campuses from server.js's per-campus arrays. Still verify explicit career
  // overrides for those institutions; otherwise stale "unchecked"/"invalid"
  // states can survive forever even after a correct URL has been supplied.
  for (const [key, ov] of overridesMap) {
    if (included.has(key) || !ov.career_url) continue;
    rows.push({
      name: ov.name,
      platform_type: clean(ov.platform_type || inferPlatformFromUrl(ov.career_url) || "generic"),
      homepage_url: canonicalizeUrl(ov.homepage_url || ov.career_url),
      career_url: canonicalizeUrl(ov.career_url),
      override_applied: true,
      override_notes: ov.notes || null,
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
  // Some institutions (confirmed: Dean College, interviewexchange.com) fail
  // this check reliably from any automated environment -- not just this
  // session's own testing, since a completely fresh GitHub Actions runner
  // with zero prior request history hits the exact same block. Verified live
  // via direct isolated checks that the link itself is fine for a real user;
  // this is a persistent anti-automation wall the checker can't get past, not
  // a real outage. Zero-tolerance --fail-on-broken turns one chronically
  // flaky (from CI's perspective) school into a weekly false-alarm failure.
  // --max-broken lets that be absorbed without going fully silent on a
  // genuine multi-school break -- default 0 preserves the original
  // zero-tolerance behavior for anyone not passing it.
  const maxBroken = Math.max(0, Number(args["max-broken"] || 0));
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

  // Several institutions can share a hosted ATS domain (interviewexchange.com,
  // schooljobs.com, workforcenow.adp.com, ...). Confirmed by hand: Dean College,
  // Farmingdale State College, and SUNY Empire State College -- all three on
  // interviewexchange.com -- each pass cleanly when checked alone, but checking
  // them in the same run trips interviewexchange's WAF into 403ing some of them,
  // purely from several concurrent connections landing on their infra at once.
  // Group by hostname and run each host's checks strictly one-at-a-time (with a
  // short stagger) so total throughput across *different* hosts stays parallel,
  // but no single host ever sees more than one of our requests at once.
  const hostGroups = new Map(); // base domain -> institutions[]
  for (const item of brokenAfterFetch) {
    let host = "unknown";
    try {
      host = baseDomain(new URL(canonicalizeUrl(item.career_url)).hostname);
    } catch {
      /* keep "unknown" -- each such item just becomes its own single-item group */
    }
    const bucketKey = host === "unknown" ? `unknown:${normalizeNameKey(item.name)}` : host;
    if (!hostGroups.has(bucketKey)) hostGroups.set(bucketKey, []);
    hostGroups.get(bucketKey).push(item);
  }
  const workUnits = Array.from(hostGroups.values());

  if (browserFallbackEnabled && workUnits.length > 0) {
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
        const poolSize = Math.min(browserConcurrency, workUnits.length);
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

        let uIdx = 0;
        async function browserWorker(context) {
          while (uIdx < workUnits.length) {
            const unit = workUnits[uIdx++];
            for (let i = 0; i < unit.length; i += 1) {
              const current = unit[i];
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
              // Stagger back-to-back requests to the same host so we don't just
              // recreate the concurrency spike within a single unit's sequence.
              if (i < unit.length - 1) await new Promise((r) => setTimeout(r, 800));
            }
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
    const fails = nextConsecutiveFailures(prevFails, v.status);
    const quarantined = isHardVerificationFailure(v.status) && fails >= quarantineThreshold;

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

  const broken = results.filter((r) => isHardVerificationFailure(r.verification_status));
  const botBlocked = results.filter((r) => r.verification_status === BOT_BLOCKED_STATUS);
  const quarantined = results.filter((r) => r.quarantined);

  const payload = {
    generatedAt: checkedAt,
    settings: {
      timeoutMs,
      concurrency,
      quarantineThreshold,
      criticalOnly,
      failOnBroken,
      maxBroken,
      browserFallbackEnabled,
      browserConcurrency,
      browserTimeoutMs,
    },
    counts: {
      checked: results.length,
      healthy: results.filter((r) => r.verification_status === "healthy").length,
      broken: broken.length,
      botBlocked: botBlocked.length,
      quarantined: quarantined.length,
      rescuedByBrowser,
      botBlockedDetectedThisRun: botBlockedCount,
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
  console.log(`Bot-blocked (not treated as broken): ${payload.counts.botBlocked}`);
  console.log(`Broken: ${payload.counts.broken}`);
  console.log(`Quarantined: ${payload.counts.quarantined}`);
  if (browserFallbackEnabled) {
    console.log(`Rescued by browser fallback: ${rescuedByBrowser} (fetch() called these broken; a real browser did not)`);
    console.log(`Still broken behind a bot challenge even in-browser: ${botBlockedCount}`);
  }
  console.log(`Wrote ${path.relative(ROOT, OUT_VERIFY_PATH)}`);

  if (failOnBroken && broken.length > maxBroken) {
    console.log(`Failing: ${broken.length} broken exceeds the tolerated max of ${maxBroken}.`);
    process.exitCode = 1;
  } else if (failOnBroken && broken.length > 0) {
    console.log(`Broken count (${broken.length}) is within the tolerated max of ${maxBroken} -- not failing.`);
  }
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
