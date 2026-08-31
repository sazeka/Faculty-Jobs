// scripts/scrape-to-json.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import { scrapeAllJobsStandalone, callLocalSummarizer, getSystemGroup, normalizeJobTitle } from "../server.js";
import { canonicalizeUrl, inferPlatformFromUrl } from "./lib/url-normalization.js";
import { shouldBlockOverwrite, healCrateredSources, isConfirmedDeadUrl } from "./lib/scrape-guard.js";
import { preserveEnrichment } from "./lib/enrichment-merge.js";
import { synchronizeJobCount } from "./lib/dataset-invariants.js";
import { filterExpiredDeadlineCache } from "./lib/post-expiration.js";
import { confirmedNonFacultyReason } from "./lib/post-quality.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Drop jobs whose URL was confirmed dead (404/410 for >= DEAD_CONFIRM consecutive
// checks, or redirected to a homepage) per the URL verifier's cache, so a listing
// page that still shows a filled posting can't keep re-introducing it each scrape.
function filterConfirmedDeadUrls(data, deadConfirm = 2) {
  if (!data || !Array.isArray(data.jobs)) return { data, removed: 0 };
  let cache;
  try {
    cache = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "generated", "job-url-cache.json"), "utf8"));
  } catch {
    return { data, removed: 0 }; // no cache yet — nothing to filter
  }
  const before = data.jobs.length;
  const jobs = data.jobs.filter((j) => !isConfirmedDeadUrl(cache[j?.url], deadConfirm));
  return { data: { ...data, jobs, count: jobs.length }, removed: before - jobs.length };
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

// Central title-cleaning choke point. Many DOM scrapers push a raw `title` and
// never call normalizeJobTitle, so messy titles (leading "**INTERNAL ONLY**" /
// year prefixes / "Region: … Open until filled" tails, etc.) re-entered the data
// every scrape — undoing any prior cleanup. Running it here, before canonical IDs
// are assigned, guarantees every job is normalized regardless of its scraper and
// that IDs are derived from the clean title. If the normalizer returns empty
// (e.g. a rejected non-job), the original title is kept — dropping is the quality
// gate's job, not this pass's.
function normalizeJobTitles(data) {
  if (!data || !Array.isArray(data.jobs)) return { data, changed: 0 };
  let changed = 0;
  const jobs = data.jobs.map((job) => {
    const before = job?.title || "";
    if (!before) return job;
    let after;
    try { after = normalizeJobTitle(before); } catch { after = before; }
    if (typeof after === "string" && after.trim() && after !== before) {
      changed += 1;
      return { ...job, title: after };
    }
    return job;
  });
  return { data: { ...data, jobs }, changed };
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

function isPlaceholderTitle(title) {
  const t = clean(title).toLowerCase();
  if (!t) return true;
  return (
    /^(faculty|staff|faculty jobs|employment|careers?)$/.test(t) ||
    /^(view details|learn more|read more|click here)$/.test(t) ||
    /^1[-\s]?\d{3}[-\s]?[a-z0-9-]+$/i.test(clean(title))
  );
}

function isLikelyJobUrl(url) {
  const u = String(url || "");
  if (!/^https?:\/\//i.test(u)) return false;
  if (/^(?:tel|mailto|sms):/i.test(u)) return false;
  // Known ATS platforms (Workday, Taleo, PeopleAdmin, ...) legitimately use "/faculty"
  // as a category or site-slug segment (e.g. Taleo's "/careersection/faculty/jobsearch.ftl",
  // a Workday site literally named ".../faculty") — the counter-check below requires an
  // exact "career"/"job" word, which doesn't match inside "careersection" or "jobsearch"
  // (no word boundary), so real ATS job-search URLs were being misclassified as faculty
  // directory/profile pages. Only apply this heuristic to generic .edu URLs, where a bare
  // "/faculty" path is much more likely to actually be a staff directory page.
  if (
    inferPlatformFromUrl(u) === "generic" &&
    /\/faculty(?:\/|$|\?)/i.test(u) &&
    !/\/(job|jobs|career|careers|employment|positions?|openings?|vacanc(y|ies))\b/i.test(u)
  ) {
    return false;
  }
  if (/\/(directory|people|our-faculty|faculty-profiles?|faculty-staff)\b/i.test(u)) return false;
  return true;
}

function applyPostQualityGates(data) {
  if (!data || !Array.isArray(data.jobs)) {
    return { data, report: { dropped: 0, reasons: {} } };
  }

  const kept = [];
  const drops = [];
  const reasons = {
    invalid_url: 0,
    non_job_url: 0,
    placeholder_title: 0,
    very_short_title: 0,
    resource_page_title: 0,
    resource_page_url: 0,
    administrative_staff_title: 0,
    student_service_title: 0,
  };

  for (const job of data.jobs) {
    const title = clean(job?.title);
    const url = clean(job?.url);
    let reason = null;
    if (!url || !/^https?:\/\//i.test(url)) reason = "invalid_url";
    else if (!isLikelyJobUrl(url)) reason = "non_job_url";
    else if (isPlaceholderTitle(title)) reason = "placeholder_title";
    else if (title.length < 8) reason = "very_short_title";
    else reason = confirmedNonFacultyReason(job);

    if (reason) {
      reasons[reason] += 1;
      if (drops.length < 200) {
        drops.push({
          reason,
          title,
          url,
          college: clean(job?.college) || null,
          source: clean(job?.source) || null,
        });
      }
      continue;
    }
    kept.push(job);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    beforeCount: data.jobs.length,
    afterCount: kept.length,
    dropped: data.jobs.length - kept.length,
    reasons,
    sampleDropped: drops,
  };

  return {
    data: { ...data, jobs: kept, count: kept.length },
    report,
  };
}

function canonicalizeJobUrls(data) {
  if (!data || !Array.isArray(data.jobs)) {
    return { data, changed: 0, removedInvalid: 0, duplicateCount: 0, sampleDuplicates: [] };
  }

  const out = [];
  // Map (not Set) so a collision can report which job it collided with —
  // the previous Set-based version silently dropped duplicates with zero
  // visibility into what was lost or why (e.g. two distinct listings whose
  // URLs canonicalize to the same value).
  const seen = new Map();
  let changed = 0;
  let removedInvalid = 0;
  let duplicateCount = 0;
  const sampleDuplicates = [];

  for (const job of data.jobs) {
    const current = job?.url || null;
    const next = canonicalizeUrl(current);
    if (!next) {
      removedInvalid += 1;
      continue;
    }
    if (next !== current) changed += 1;
    if (seen.has(next)) {
      duplicateCount += 1;
      if (sampleDuplicates.length < 200) {
        const kept = seen.get(next);
        sampleDuplicates.push({
          canonicalUrl: next,
          dropped: { title: job?.title || null, college: job?.college || null, source: job?.source || null, originalUrl: current },
          keptInstead: { title: kept?.title || null, college: kept?.college || null, source: kept?.source || null, originalUrl: kept?.url || null },
        });
      }
      continue;
    }
    seen.set(next, job);
    out.push({ ...job, url: next });
  }

  return {
    data: { ...data, jobs: out, count: out.length },
    changed,
    removedInvalid,
    duplicateCount,
    sampleDuplicates,
  };
}

(async () => {
  let data = await scrapeAllJobsStandalone(); // { scrapedAt, count, jobs }

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
  if (canonicalized.duplicateCount > 0) {
    console.log(`🧬 Canonicalization collapsed ${canonicalized.duplicateCount} duplicate-URL job(s) (see generated/job-url-dedup-report.json)`);
    const dedupReportPath = path.join(__dirname, "..", "generated", "job-url-dedup-report.json");
    fs.mkdirSync(path.dirname(dedupReportPath), { recursive: true });
    fs.writeFileSync(
      dedupReportPath,
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          duplicateCount: canonicalized.duplicateCount,
          sampleDuplicates: canonicalized.sampleDuplicates,
        },
        null,
        2
      )}\n`,
      "utf8"
    );
  }

  // Clean every title BEFORE canonical IDs are derived from it, so no scraper can
  // re-introduce messy titles (and IDs stay stable across scrapes).
  const titled = normalizeJobTitles(data);
  data = titled.data;
  if (titled.changed > 0) {
    console.log(`✂️  Normalized ${titled.changed} job titles`);
  }

  const canonicalIds = addCanonicalIds(data);
  data = canonicalIds.data;
  if (canonicalIds.assigned > 0) {
    console.log(`🧬 Assigned canonical IDs for ${canonicalIds.assigned} jobs`);
  }

  const quality = applyPostQualityGates(data);
  data = quality.data;
  const qualityReportPath = path.join(__dirname, "..", "generated", "post-quality-report.json");
  fs.mkdirSync(path.dirname(qualityReportPath), { recursive: true });
  fs.writeFileSync(qualityReportPath, `${JSON.stringify(quality.report, null, 2)}\n`, "utf8");
  if (quality.report.dropped > 0) {
    console.log(`🧹 Quality gates dropped ${quality.report.dropped} listings`);
  }
  console.log(`📄 Wrote ${qualityReportPath}`);

  // Drop listings whose URL the verifier has confirmed dead, so a stale listing
  // page can't keep re-introducing filled postings each scrape.
  const deadFilter = filterConfirmedDeadUrls(data);
  if (deadFilter.removed > 0) {
    data = deadFilter.data;
    console.log(`⚰️  Filtered ${deadFilter.removed} confirmed-dead URL(s) from scrape`);
  }

  const targets = [
    path.join(__dirname, "..", "docs", "jobs.json"),
    path.join(__dirname, "..", "public", "jobs.json"),
    path.join(__dirname, "..", "web-vue", "public", "jobs.json"),
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

  // Always-on per-source/per-college anti-flake healing (runs even with no CAMPUS_ALLOWLIST).
  // Match the data-health alert policy: if a source is large enough to open a
  // 60%-drop issue, it must also be large enough for this pre-write guard to
  // heal. The old 20/70 defaults let ND fall 16 -> 5 and only complained after
  // the damaged snapshot had already been published.
  const healMinBaseline = Number(process.env.SOURCE_HEAL_MIN_BASELINE || 10);
  const healDropPct = Number(process.env.SOURCE_HEAL_DROP_PCT || 60);
  if (process.env.DISABLE_SOURCE_HEAL !== "1") {
    const heal = healCrateredSources(data, previousData, {
      minBaseline: healMinBaseline,
      dropPct: healDropPct,
    });
    if (heal.healed.length > 0) {
      data = heal.data;
      console.warn(
        `🩹 Healed ${heal.healed.length} cratered source/campus group(s), restored ${heal.jobsRestored} jobs from previous snapshot:`
      );
      for (const h of heal.healed) {
        const label = h.college ? `${h.source} / ${h.college}` : h.source;
        console.warn(`   - ${label}: ${h.current} → restored to ${h.restoredTo} (baseline ${h.baseline})`);
      }
      const healReportPath = path.join(__dirname, "..", "generated", "source-heal-report.json");
      fs.writeFileSync(
        healReportPath,
        `${JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            config: { minBaseline: healMinBaseline, dropPct: healDropPct },
            healed: heal.healed,
            jobsRestored: heal.jobsRestored,
          },
          null,
          2
        )}\n`,
        "utf8"
      );
      console.warn(`   Report written to ${healReportPath}`);
    }
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

  // Carry enrichment (discipline/positionType/tenureTrack) forward from the
  // previous snapshot. The scraper produces raw listings with none of these, and
  // CI has no LLM to re-run agent:enrich — without this, every daily scrape wipes
  // the enrichment off the live site. Only fills fields the fresh job is missing.
  if (process.env.DISABLE_ENRICHMENT_PRESERVE !== "1") {
    const merged = preserveEnrichment(data, previousData);
    data = merged.data;
    if (merged.restoredFields > 0) {
      console.log(
        `🧬 Preserved enrichment: filled ${merged.restoredFields} field(s) across ${merged.jobsTouched} job(s) (${merged.matched} matched previous snapshot)`
      );
    }
  }

  // A source can continue advertising a URL after its explicit application
  // deadline, and a fresh scrape may no longer carry the description metadata
  // that supplied that deadline. Keep a persistent URL ledger so safely purged
  // postings cannot reappear without explicit evidence of a new deadline or a
  // rolling/open-until-filled status.
  const presencePath = path.join(__dirname, "..", "generated", "job-presence.json");
  let expirationLedger = null;
  try { expirationLedger = JSON.parse(fs.readFileSync(presencePath, "utf8")); } catch {}
  const deadlineFiltered = filterExpiredDeadlineCache(data.jobs, expirationLedger?.expiredDeadlines, {
    today: new Date(),
    graceDays: 7,
  });
  if (deadlineFiltered.expired.length > 0) {
    data = { ...data, jobs: deadlineFiltered.kept };
    console.log(`🗓️  Filtered ${deadlineFiltered.expired.length} previously expired deadline URL(s)`);
  }

  // Final write boundary: downstream passes may replace or filter the job array,
  // so derive metadata from the finished payload instead of trusting an earlier
  // pipeline stage's count.
  data = synchronizeJobCount(data);

  for (const outPath of targets) {
    fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
    console.log(`✅ Wrote ${outPath} (${data.count} jobs)`);
  }
})();
