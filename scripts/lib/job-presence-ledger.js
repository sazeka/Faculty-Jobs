// Presence-ledger bookkeeping for agent-job-presence.js.
//
// The ledger (generated/job-presence.json) is keyed by canonicalJobId, so any
// change to the ID formula (e.g. #166's canonical-id.js rewrite) makes every
// job look brand new. The scrape step already carries each job's previous
// firstSeen across by canonicalJobId *or url* (preserveEnrichment), so the
// job itself is the better witness: a new or re-keyed ledger entry starts at
// the earliest of the job's carried firstSeen and today, never later. Without
// this, the 2026-09-19 scrape reset firstSeen for ~22.5k listings.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Returns a YYYY-MM-DD firstSeen if plausible (not after `today`), else null. */
export function validFirstSeen(value, today) {
  const date = String(value || "").trim().slice(0, 10);
  if (!DATE_RE.test(date) || date > today) return null;
  return date;
}

function earliest(...dates) {
  return dates.filter(Boolean).sort()[0] || null;
}

/**
 * Upserts today's jobs into the presence ledger (mutates `presence.jobs`):
 * seen jobs get lastSeen=today and consecutiveMisses=0, unseen tracked jobs
 * get consecutiveMisses+1. firstSeen is the earliest of the ledger's value,
 * the job's carried firstSeen and (for new entries) today.
 */
export function updatePresenceLedger(presence, todayJobs, today) {
  const carriedById = new Map();
  for (const job of todayJobs || []) {
    const id = job?.canonicalJobId;
    if (typeof id !== "string" || !id) continue;
    const carried = validFirstSeen(job.firstSeen, today);
    carriedById.set(id, earliest(carriedById.get(id), carried));
  }

  for (const [id, carried] of carriedById) {
    const entry = presence.jobs[id];
    if (entry) {
      entry.firstSeen = earliest(validFirstSeen(entry.firstSeen, today), carried, today);
      entry.lastSeen = today;
      entry.consecutiveMisses = 0;
    } else {
      presence.jobs[id] = {
        firstSeen: earliest(carried, today),
        lastSeen: today,
        consecutiveMisses: 0,
      };
    }
  }

  for (const [id, entry] of Object.entries(presence.jobs)) {
    if (!carriedById.has(id)) entry.consecutiveMisses = (entry.consecutiveMisses || 0) + 1;
  }

  return new Set(carriedById.keys());
}
