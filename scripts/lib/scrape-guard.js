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

  const cratered = new Set();
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
  if (cratered.size === 0) return empty;

  // Drop the (likely-flaky) new jobs for cratered sources, splice in the previous ones.
  const jobs = newData.jobs.filter((j) => !cratered.has(String(j?.source || "").trim()));
  let jobsRestored = 0;
  for (const j of prevData.jobs) {
    if (cratered.has(String(j?.source || "").trim())) {
      jobs.push(j);
      jobsRestored += 1;
    }
  }

  return { data: { ...newData, jobs, count: jobs.length }, healed, jobsRestored };
}
