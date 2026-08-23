#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { excludePreviouslyReported, isRejectedCareerPage } from "./lib/career-path-probe.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const MASTER_PATH = path.join(ROOT, "data", "institutions-master.json");
const POLICY_RULES_PATH = path.join(ROOT, "data", "policy-rules.json");
const REPORT_PATH = path.join(ROOT, "generated", "career-discovery-report.json");
const REVIEW_CSV_PATH = path.join(ROOT, "generated", "career-discovery-review.csv");

function usage() {
  console.log(
    "Usage: node scripts/discover-career-pages.js [--apply] [--limit N] [--delay-ms N] [--min-confidence 0.65] [--weak-only|--medium-only] [--skip-report FILE] [--all-missing]"
  );
}

function clean(v) {
  return String(v || "").replace(/\s+/g, " ").trim();
}

function normalize(v) {
  return clean(v).toLowerCase();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function inferPlatformFromUrl(url) {
  const u = normalize(url);
  if (!u) return null;
  if (u.includes("myworkdayjobs.com") || u.includes("myworkdaysite.com")) return "workday";
  if (u.includes("pageuppeople.com")) return "pageup";
  if (u.includes("taleo.net")) return "taleo";
  if (u.includes("peopleadmin.com")) return "peopleadmin";
  if (u.includes("schooljobs.com")) return "schooljobs";
  if (u.includes("csod.com")) return "csod";
  if (u.includes("paycomonline.net")) return "paycom";
  if (u.includes("interviewexchange.com")) return "interviewexchange";
  if (u.includes("jobvite.com")) return "jobvite";
  if (u.includes("interfolio.com")) return "interfolio";
  if (u.includes("greenhouse.io")) return "greenhouse";
  if (u.includes("lever.co")) return "lever";
  if (u.includes("icims.com")) return "icims";
  if (u.includes("/en-us/filter")) return "enusfilter";
  return "generic";
}

function buildSearchQueries(instName) {
  const n = clean(instName);
  return [
    `${n} faculty jobs careers`,
    `${n} academic jobs`,
    `${n} faculty employment`,
    `${n} human resources faculty positions`,
  ];
}

function decodeDdgRedirect(url) {
  try {
    const u = new URL(url);
    if (u.pathname.startsWith("/l/") && u.searchParams.get("uddg")) {
      return decodeURIComponent(u.searchParams.get("uddg"));
    }
    return url;
  } catch {
    return url;
  }
}

function extractCandidateUrlsFromDdgHtml(html) {
  const urls = [];
  const re = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    if (!href) continue;
    const decoded = decodeDdgRedirect(href);
    if (/^https?:\/\//i.test(decoded)) urls.push(decoded);
  }

  // Fallback: capture uddg links if class markup changes.
  if (urls.length === 0) {
    const reAlt = /uddg=([^&"'>\s]+)/gi;
    while ((m = reAlt.exec(html)) !== null) {
      try {
        const decoded = decodeURIComponent(m[1]);
        if (/^https?:\/\//i.test(decoded)) urls.push(decoded);
      } catch {
        // ignore bad decode
      }
    }
  }

  return [...new Set(urls)];
}

function looksBadCandidate(url) {
  const u = normalize(url);
  if (!u) return true;
  const deny = [
    "wikipedia.org",
    "linkedin.com",
    "facebook.com",
    "instagram.com",
    "x.com",
    "twitter.com",
    "youtube.com",
    "myjobmag.",
    "jobs.chronicle.com",
    "careers.insidehighered.com",
    "news.",
    "/news",
    "/events",
    "/giving",
    "/alumni",
    "career-services",
    "career-readiness",
    "career-exploration",
    "career-design",
    "career-professional-development",
    "career-transfer-center",
    "career-and-testing-services",
    "center-for-career-success",
    "student-employment",
    "academic-career-support",
  ];
  return deny.some((d) => u.includes(d));
}

function urlContainsSchoolToken(url, schoolName) {
  const u = normalize(url);
  const words = normalize(schoolName)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !["university", "college", "state", "system", "school"].includes(w));
  return words.some((w) => u.includes(w));
}

function scoreCandidate(url, schoolName) {
  const u = normalize(url);
  let score = 0;

  if (looksBadCandidate(u)) score -= 0.4;

  if (
    u.includes("myworkdayjobs.com") ||
    u.includes("myworkdaysite.com") ||
    u.includes("pageuppeople.com") ||
    u.includes("taleo.net") ||
    u.includes("peopleadmin.com") ||
    u.includes("schooljobs.com") ||
    u.includes("csod.com") ||
    u.includes("interfolio.com") ||
    u.includes("jobvite.com") ||
    u.includes("icims.com")
  ) {
    score += 0.6;
  }

  if (/\bfaculty\b|\bprofessor\b|\bacademic\b|\binstructor\b|\blecturer\b/.test(u)) score += 0.25;
  if (/\bjobs\b|\bcareers\b|\bemployment\b|\brecruiting\b|\bjobsearch\b/.test(u)) score += 0.2;
  if (/\.edu\b/.test(u)) score += 0.1;
  if (urlContainsSchoolToken(u, schoolName)) score += 0.15;
  if (/\/login|sign[\-_]?in|sso|auth/.test(u)) score -= 0.2;

  if (score < 0) score = 0;
  if (score > 0.99) score = 0.99;
  return Number(score.toFixed(2));
}

function extractOfficialCareerLinks(html, baseUrl) {
  const links = [];
  const seen = new Set();
  const anchorRe = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = anchorRe.exec(String(html || ""))) !== null) {
    const raw = match[1]
      .replace(/&amp;/gi, "&")
      .replace(/&#38;/g, "&")
      .trim();
    let url;
    try {
      url = new URL(raw, baseUrl).toString();
    } catch {
      continue;
    }
    if (!/^https?:\/\//i.test(url) || seen.has(url) || looksBadCandidate(url)) continue;
    const normalized = normalize(url);
    const hiringPath = /career|careers|employment|human-resources|\/hr\b|faculty-position|openings|job-opportunities|work-with-us|join-our-team|recruitment/.test(normalized);
    const knownAts = /myworkdayjobs\.com|myworkdaysite\.com|pageuppeople\.com|taleo\.net|peopleadmin\.com|schooljobs\.com|governmentjobs\.com|csod\.com|paycomonline\.net|interviewexchange\.com|jobvite\.com|interfolio\.com|greenhouse\.io|lever\.co|icims\.com|workforcenow\.adp\.com|applicantstack\.com|silkroad\.com/.test(normalized);
    if (!hiringPath && !knownAts) continue;
    seen.add(url);
    links.push(url);
  }
  return links;
}

async function fetchOfficialHomepageLinks(inst, timeoutMs = 12000) {
  const homepage = clean(inst.homepage_url);
  if (!homepage) return { ok: false, reason: "missing_homepage", urls: [] };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(homepage, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 FacultyJobsDiscovery/1.0" },
    });
    if (!response.ok) return { ok: false, reason: `homepage_http_${response.status}`, urls: [] };
    const finalUrl = response.url || homepage;
    return {
      ok: true,
      method: "official_homepage_links",
      urls: extractOfficialCareerLinks(await response.text(), finalUrl),
    };
  } catch (error) {
    return { ok: false, reason: error?.name === "AbortError" ? "homepage_timeout" : "homepage_fetch_error", urls: [] };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchDdgResults(query, timeoutMs = 12000) {
  const searchUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(searchUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 FacultyJobsDiscovery/1.0",
      },
    });
    if (!resp.ok) {
      return { ok: false, reason: `search_http_${resp.status}`, candidates: [] };
    }

    return {
      ok: true,
      query,
      urls: extractCandidateUrlsFromDdgHtml(await resp.text()).filter((u) => !looksBadCandidate(u)),
      method: "duckduckgo_html",
    };
  } catch (e) {
    return { ok: false, reason: e?.name === "AbortError" ? "timeout" : "fetch_error", error: e?.message || String(e), urls: [] };
  } finally {
    clearTimeout(timer);
  }
}

async function discoverForInstitution(inst, timeoutMs = 12000) {
  const queries = buildSearchQueries(inst.name);
  const candidateByUrl = new Map();
  const queryResults = [];

  const officialLinks = await fetchOfficialHomepageLinks(inst, timeoutMs);
  queryResults.push({
    query: "official homepage links",
    ok: officialLinks.ok,
    reason: officialLinks.reason || null,
    count: (officialLinks.urls || []).length,
  });
  for (const url of officialLinks.urls || []) {
    candidateByUrl.set(url, {
      url,
      confidence: scoreCandidate(url, inst.name),
      platform_type: inferPlatformFromUrl(url),
      query: "official homepage links",
    });
  }

  for (const query of queries) {
    const r = await fetchDdgResults(query, timeoutMs);
    queryResults.push({ query, ok: r.ok, reason: r.reason || null, count: (r.urls || []).length });
    if (!r.ok) {
      if (r.reason === "search_http_403" || r.reason === "search_http_429") break;
      continue;
    }

    for (const url of r.urls || []) {
      const confidence = scoreCandidate(url, inst.name);
      const existing = candidateByUrl.get(url);
      if (!existing || confidence > existing.confidence) {
        candidateByUrl.set(url, {
          url,
          confidence,
          platform_type: inferPlatformFromUrl(url),
          query,
        });
      }
    }
  }

  const candidates = [...candidateByUrl.values()]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 10);
  const validated = [];
  const rejected = [];
  await Promise.all(candidates.slice(0, 6).map(async (candidate) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(candidate.url, {
        signal: controller.signal,
        redirect: "follow",
        headers: { "User-Agent": "Mozilla/5.0 FacultyJobsDiscovery/1.0" },
      });
      const body = response.ok ? await response.text() : "";
      const finalUrl = response.url || candidate.url;
      if (!response.ok) {
        rejected.push({ ...candidate, reason: `candidate_http_${response.status}` });
        return;
      }
      if (isRejectedCareerPage(finalUrl, body)) {
        rejected.push({ ...candidate, url: finalUrl, reason: "rejected_non_employee_career_page" });
        return;
      }

      const text = normalize(body.replace(/<[^>]+>/g, " ")).slice(0, 40000);
      const employeeEvidence = /employment opportunities|current openings|job openings|open positions|faculty positions|staff positions|search (?:for )?jobs|apply for (?:a )?position|join our (?:team|faculty|staff)|work (?:at|for|with)\b|equal opportunity employer|applicants? for employment/.test(text);
      const knownAts = /myworkdayjobs\.com|myworkdaysite\.com|pageuppeople\.com|taleo\.net|peopleadmin\.com|schooljobs\.com|governmentjobs\.com|csod\.com|paycomonline\.net|interviewexchange\.com|jobvite\.com|interfolio\.com|greenhouse\.io|lever\.co|icims\.com|workforcenow\.adp\.com|applicantstack\.com|silkroad\.com/.test(normalize(finalUrl));
      if (!employeeEvidence && !knownAts) {
        rejected.push({ ...candidate, url: finalUrl, reason: "no_employee_hiring_evidence" });
        return;
      }

      let officialDomain = false;
      try {
        const candidateHost = new URL(finalUrl).hostname.replace(/^www\./i, "");
        const homepageHost = new URL(inst.homepage_url).hostname.replace(/^www\./i, "");
        officialDomain = candidateHost === homepageHost || candidateHost.endsWith(`.${homepageHost}`) || homepageHost.endsWith(`.${candidateHost}`);
      } catch {
        officialDomain = false;
      }
      const normalizedInstitutionName = normalize(inst.name).replace(/[^a-z0-9]+/g, " ").trim();
      const normalizedEvidenceText = text.replace(/[^a-z0-9]+/g, " ");
      const institutionNamed = normalizedInstitutionName.length >= 5 && normalizedEvidenceText.includes(normalizedInstitutionName);
      if (!officialDomain && (!knownAts || !institutionNamed)) {
        rejected.push({ ...candidate, url: finalUrl, reason: "institution_identity_mismatch" });
        return;
      }

      const evidenceBoost = employeeEvidence ? 0.15 : 0;
      const confidence = Math.min(0.99, Number((scoreCandidate(finalUrl, inst.name) + evidenceBoost).toFixed(2)));
      validated.push({
        ...candidate,
        url: finalUrl,
        confidence,
        platform_type: inferPlatformFromUrl(finalUrl),
        validation: employeeEvidence ? "employee_hiring_evidence" : "recognized_ats",
      });
    } catch (error) {
      rejected.push({ ...candidate, reason: error?.name === "AbortError" ? "candidate_timeout" : "candidate_fetch_error" });
    } finally {
      clearTimeout(timer);
    }
  }));

  validated.sort((a, b) => b.confidence - a.confidence);
  const best = validated[0] || null;
  if (!best) {
    return {
      ok: false,
      reason: "no_candidates",
      candidates: validated,
      rejectedCandidates: rejected,
      queryResults,
      method: "duckduckgo_html",
    };
  }

  return {
    ok: true,
    reason: "candidate_found",
    best,
    candidates: validated,
    rejectedCandidates: rejected,
    queryResults,
    method: "duckduckgo_html",
    query: best.query || queries[0],
  };
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const out = {
    apply: false,
    limit: 50,
    delayMs: 700,
    minConfidence: 0.65,
    scopeEligibleOnly: true,
    weakOnly: false,
    mediumOnly: false,
    skipReports: [],
    timeoutMs: 8000,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--help" || a === "-h") {
      usage();
      process.exit(0);
    }
    if (a === "--apply") out.apply = true;
    else if (a === "--limit" && args[i + 1]) out.limit = Math.max(1, Number(args[++i]));
    else if (a === "--delay-ms" && args[i + 1]) out.delayMs = Math.max(0, Number(args[++i]));
    else if (a === "--min-confidence" && args[i + 1]) out.minConfidence = Math.max(0, Math.min(1, Number(args[++i])));
    else if (a === "--timeout-ms" && args[i + 1]) out.timeoutMs = Math.max(2000, Number(args[++i]));
    else if (a === "--weak-only") out.weakOnly = true;
    else if (a === "--medium-only") out.mediumOnly = true;
    else if (a === "--skip-report" && args[i + 1]) out.skipReports.push(args[++i]);
    else if (a === "--all-missing") out.scopeEligibleOnly = false;
  }
  return out;
}

function readJsonOrNull(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function isEligibleByScope(inst, scope) {
  if (!scope) return true;
  const level = normalize(inst.level);
  const control = normalize(inst.control);
  const includeLevels = Array.isArray(scope.levelsIncluded) ? scope.levelsIncluded.map((x) => normalize(x)) : [];
  const excludeLevels = Array.isArray(scope.excludeLevels) ? scope.excludeLevels.map((x) => normalize(x)) : [];
  const excludeControls = Array.isArray(scope.excludeControls) ? scope.excludeControls.map((x) => normalize(x)) : [];
  if (includeLevels.length > 0 && level && !includeLevels.includes(level)) return false;
  if (excludeLevels.length > 0 && level && excludeLevels.includes(level)) return false;
  if (excludeControls.length > 0 && control && excludeControls.includes(control)) return false;
  if (normalize(scope.target) === "degree-granting" && inst.is_degree_granting === false) return false;
  return true;
}

function ensureMasterShape(master) {
  if (!master || typeof master !== "object") throw new Error("Invalid institutions-master.json");
  if (!Array.isArray(master.institutions)) throw new Error("institutions-master.json missing institutions array");
}

function attemptRank(inst) {
  const ts = clean(inst.last_discovery_attempt_at);
  if (!ts) return Number.NEGATIVE_INFINITY;
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}

function csvEscape(v) {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writeReviewCsv(results) {
  const rows = [];
  for (const r of results) {
    if (r.status !== "unresolved") continue;
    const top = Array.isArray(r.topCandidates) ? r.topCandidates.slice(0, 3) : [];
    const best = top[0];
    if (!best || Number(best.confidence || 0) < 0.45) continue;
    rows.push({
      institution: r.name || "",
      state: r.state || "",
      level: r.level || "",
      best_confidence: Number(best.confidence || 0),
      best_url: best.url || "",
      best_platform: best.platform_type || "",
      candidate_2: top[1]?.url || "",
      candidate_3: top[2]?.url || "",
      reason: r.reason || "",
    });
  }

  const headers = [
    "institution",
    "state",
    "level",
    "best_confidence",
    "best_url",
    "best_platform",
    "candidate_2",
    "candidate_3",
    "reason",
  ];
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(","));
  }
  fs.mkdirSync(path.dirname(REVIEW_CSV_PATH), { recursive: true });
  fs.writeFileSync(REVIEW_CSV_PATH, lines.join("\n") + "\n", "utf8");
}

async function main() {
  const opts = parseArgs(process.argv);
  const reportOptions = {
    ...opts,
    skipReports: opts.skipReports.map((reportPath) => path.basename(reportPath)),
  };
  const master = JSON.parse(fs.readFileSync(MASTER_PATH, "utf8"));
  ensureMasterShape(master);
  const policyRules = readJsonOrNull(POLICY_RULES_PATH);
  const scope = policyRules?.scope || null;

  let targets = master.institutions
    .filter((r) => normalize(r.coverage_status) === "missing")
    .filter((r) => opts.weakOnly || opts.mediumOnly || !clean(r.career_url) || !clean(r.platform_type));

  if (opts.scopeEligibleOnly) {
    targets = targets.filter((r) => isEligibleByScope(r, scope));
  }

  if (opts.weakOnly) {
    targets = targets.filter((r) => {
      const confidence = Number(r.last_discovery_confidence || 0);
      return confidence > 0 && confidence < 0.55;
    });
  }

  if (opts.mediumOnly) {
    targets = targets.filter((r) => {
      const confidence = Number(r.last_discovery_confidence || 0);
      return confidence >= 0.55 && confidence < opts.minConfidence;
    });
  }

  for (const reportPath of opts.skipReports) {
    const skipPath = path.resolve(ROOT, reportPath);
    const previousReport = readJsonOrNull(skipPath);
    targets = excludePreviouslyReported(targets, previousReport?.results);
  }

  targets = targets
    .sort((a, b) => {
      if (opts.weakOnly || opts.mediumOnly) {
        const confidenceDelta = Number(b.last_discovery_confidence || 0) - Number(a.last_discovery_confidence || 0);
        if (confidenceDelta !== 0) return confidenceDelta;
      }
      const da = attemptRank(a);
      const db = attemptRank(b);
      if (da !== db) return da - db; // oldest / never-attempted first
      return clean(a.name).localeCompare(clean(b.name));
    })
    .slice(0, opts.limit);

  if (targets.length === 0) {
    const report = {
      generatedAt: new Date().toISOString(),
      options: reportOptions,
      scanned: 0,
      updated: 0,
      note: opts.scopeEligibleOnly
        ? "No eligible missing institutions require discovery (career_url/platform_type already present)."
        : "No missing institutions require discovery (career_url/platform_type already present).",
      results: [],
    };
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n", "utf8");
    console.log("No eligible targets for discovery. Wrote generated/career-discovery-report.json");
    return;
  }

  console.log(`Discovering career pages for ${targets.length} institutions (limit=${opts.limit})...`);

  let updated = 0;
  const results = [];

  for (let i = 0; i < targets.length; i++) {
    const inst = targets[i];
    const name = clean(inst.name);
    const attemptedAt = new Date().toISOString();
    console.log(`[${i + 1}/${targets.length}] ${name}`);

    // Fast path: infer missing platform type from existing URL.
    if (clean(inst.career_url) && !clean(inst.platform_type)) {
      const inferred = inferPlatformFromUrl(inst.career_url);
      const canApply = Boolean(inferred);
      if (opts.apply && canApply) {
        inst.platform_type = inferred;
        inst.last_checked_at = new Date().toISOString();
        inst.last_discovery_attempt_at = attemptedAt;
        inst.last_discovery_status = canApply ? "inferred_platform" : "no_infer";
        inst.last_discovery_confidence = canApply ? 0.99 : 0;
        inst.discovery_attempts = Number(inst.discovery_attempts || 0) + 1;
        updated += 1;
      } else if (opts.apply) {
        inst.last_discovery_attempt_at = attemptedAt;
        inst.last_discovery_status = "no_infer";
        inst.last_discovery_confidence = 0;
        inst.discovery_attempts = Number(inst.discovery_attempts || 0) + 1;
      }
      results.push({
        name,
        state: inst.state || null,
        level: inst.level || null,
        status: canApply ? "inferred_platform" : "no_infer",
        career_url: inst.career_url || null,
        platform_type: inferred,
        confidence: canApply ? 0.99 : 0,
        applied: opts.apply && canApply,
      });
      continue;
    }

    const found = await discoverForInstitution(inst, opts.timeoutMs);
    let applied = false;

    if (found.ok && found.best && found.best.confidence >= opts.minConfidence) {
      if (opts.apply) {
        if (opts.weakOnly || opts.mediumOnly || !clean(inst.career_url)) inst.career_url = found.best.url;
        if (opts.weakOnly || opts.mediumOnly || !clean(inst.platform_type)) inst.platform_type = found.best.platform_type || inferPlatformFromUrl(found.best.url);
        inst.last_checked_at = new Date().toISOString();
        inst.last_discovery_attempt_at = attemptedAt;
        inst.last_discovery_status = "discovered";
        inst.last_discovery_confidence = Number(found.best.confidence || 0);
        inst.discovery_attempts = Number(inst.discovery_attempts || 0) + 1;
        inst.notes = clean(`${inst.notes || ""} Auto-discovered via ${found.method} (${new Date().toISOString()}).`).trim();
        updated += 1;
        applied = true;
      }

      results.push({
        name,
        state: inst.state || null,
        level: inst.level || null,
        status: "discovered",
        career_url: found.best.url,
        platform_type: found.best.platform_type,
        confidence: found.best.confidence,
        method: found.method,
        query: found.query,
        applied,
        topCandidates: found.candidates,
        queryResults: found.queryResults || [],
      });
    } else {
      if (opts.apply) {
        if (opts.weakOnly || opts.mediumOnly) {
          inst.career_url = null;
          inst.platform_type = null;
        }
        inst.last_discovery_attempt_at = attemptedAt;
        inst.last_discovery_status = "unresolved";
        inst.last_discovery_confidence = Number(found.best?.confidence || 0);
        inst.discovery_attempts = Number(inst.discovery_attempts || 0) + 1;
      }
      results.push({
        name,
        state: inst.state || null,
        level: inst.level || null,
        status: "unresolved",
        reason: found.reason,
        error: found.error || null,
        confidence: found.best?.confidence || 0,
        topCandidates: found.candidates || [],
        queryResults: found.queryResults || [],
      });
    }

    if (opts.delayMs > 0 && i < targets.length - 1) await sleep(opts.delayMs);
  }

  if (opts.apply) {
    master.generatedAt = new Date().toISOString();
    master.counts = {
      ...(master.counts || {}),
      totalInstitutions: master.institutions.length,
      covered: master.institutions.filter((r) => normalize(r.coverage_status) === "covered").length,
      missing: master.institutions.filter((r) => normalize(r.coverage_status) === "missing").length,
    };
    fs.writeFileSync(MASTER_PATH, JSON.stringify(master, null, 2) + "\n", "utf8");
  }

  const report = {
    generatedAt: new Date().toISOString(),
    options: reportOptions,
    scanned: targets.length,
    updated,
    unresolved: results.filter((r) => r.status === "unresolved").length,
    discovered: results.filter((r) => r.status === "discovered").length,
    inferredPlatform: results.filter((r) => r.status === "inferred_platform").length,
    results,
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n", "utf8");
  writeReviewCsv(results);

  console.log(`Wrote ${path.relative(ROOT, REPORT_PATH)} (scanned=${report.scanned}, updated=${updated})`);
  console.log(`Wrote ${path.relative(ROOT, REVIEW_CSV_PATH)}`);
  if (opts.apply) console.log(`Updated ${path.relative(ROOT, MASTER_PATH)}`);
}

main();
