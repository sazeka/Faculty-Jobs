// Snapshot-safety helpers for the scraper. Pure functions, unit-tested in
// scripts/__tests__/scrape-guard.test.js.

export function countBySource(data) {
  const out = {};
  for (const j of data?.jobs || []) {
    const s = String(j?.source || "").trim();
    if (!s) continue;
    out[s] = (out[s] || 0) + 1;
  }
  return out;
}

function sourceCollegeKey(job) {
  const source = String(job?.source || "").trim();
  const college = String(job?.college || "").trim();
  return source && college ? `${source}\u0000${college}` : null;
}

function countBySourceCollege(data) {
  const out = {};
  for (const job of data?.jobs || []) {
    const key = sourceCollegeKey(job);
    if (key) out[key] = (out[key] || 0) + 1;
  }
  return out;
}

// Hard block: discard the whole new snapshot when an allowlisted set of sources
// collapses (a strong signal of an anti-bot/blocked run). Requires CAMPUS_ALLOWLIST.
export function shouldBlockOverwrite(newData, prevData, allowlistRaw) {
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

// True when a URL-verifier cache entry represents a CONFIRMED-dead posting: a
// homepage redirect (stable "posting gone" signal), or 404/410 sustained for
// `deadConfirm` consecutive checks. A single transient 404 (deadStreak < threshold)
// is NOT confirmed, so it won't trigger pruning.
export function isConfirmedDeadUrl(cacheEntry, deadConfirm = 2) {
  if (!cacheEntry) return false;
  if (cacheEntry.status === "homepage-redirect") return true;
  return cacheEntry.status === "dead" && (cacheEntry.deadStreak || 0) >= deadConfirm;
}

// Surgical anti-flake guard: if a source's job count craters versus the previous
// snapshot (a strong signal of a blocked/timed-out scrape, not a real listing
// drop), restore THAT source's previous jobs while still accepting fresh data for
// every healthy source. Unlike shouldBlockOverwrite this is always on (no allowlist
// required) and never discards the whole run — it only patches the cratered source.
export function healCrateredSources(newData, prevData, { minBaseline, dropPct }) {
  const empty = { data: newData, healed: [], jobsRestored: 0 };
  if (!prevData || !Array.isArray(prevData.jobs) || prevData.jobs.length === 0) return empty;
  if (!newData || !Array.isArray(newData.jobs) || newData.jobs.length === 0) return empty;

  const prevBy = countBySource(prevData);
  const nextBy = countBySource(newData);
  const prevByCollege = countBySourceCollege(prevData);
  const nextByCollege = countBySourceCollege(newData);

  const cratered = new Set();
  const crateredColleges = new Set();
  const healed = [];
  for (const s of Object.keys(prevBy)) {
    const p = prevBy[s] || 0;
    const n = nextBy[s] || 0;
    // Threshold = the minimum count we'd tolerate before calling it a crater.
    const floor = Math.ceil(p * (1 - dropPct / 100));
    if (p >= minBaseline && n < floor) {
      cratered.add(s);
      healed.push({ source: s, baseline: p, current: n, restoredTo: p });
    }
  }

  // A state/system source can remain above the aggregate crater threshold even
  // when one large campus fails (UNM fell 33 -> 2 while the rest of NM kept the
  // source total at 18). Apply the same guard per source+college unless the
  // entire source is already being restored.
  for (const key of Object.keys(prevByCollege)) {
    const [source, college] = key.split("\u0000");
    if (cratered.has(source)) continue;
    const p = prevByCollege[key] || 0;
    const n = nextByCollege[key] || 0;
    const floor = Math.ceil(p * (1 - dropPct / 100));
    if (p >= minBaseline && n < floor) {
      crateredColleges.add(key);
      healed.push({ source, college, baseline: p, current: n, restoredTo: p });
    }
  }
  if (cratered.size === 0 && crateredColleges.size === 0) return empty;

  // Drop the (likely-flaky) new jobs for cratered sources, splice in the previous ones.
  const shouldRestore = (job) => {
    const source = String(job?.source || "").trim();
    return cratered.has(source) || crateredColleges.has(sourceCollegeKey(job));
  };
  const jobs = newData.jobs.filter((job) => !shouldRestore(job));
  let jobsRestored = 0;
  for (const job of prevData.jobs) {
    if (shouldRestore(job)) {
      jobs.push(job);
      jobsRestored += 1;
    }
  }

  return { data: { ...newData, jobs, count: jobs.length }, healed, jobsRestored };
}
