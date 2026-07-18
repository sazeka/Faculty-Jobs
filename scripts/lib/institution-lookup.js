// Best-effort name/alias lookup against data/institutions-master.json, used to
// pull an institution's homepage for JobPosting hiringOrganization.sameAs/logo
// and for hub-page "official site" links. Matching is approximate (normalized
// exact match on name or alias) — a miss just means those optional fields are
// omitted, it never blocks page generation.
import fs from "fs";

function normalizeName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Even "healthy"-verified records sometimes have homepage_url actually
// pointing at a career/postings search page rather than the institution's
// real homepage (e.g. Boise State's homepage_url and career_url are
// identical; UNMC's homepage_url is a peopleadmin.com postings search).
// Reject anything that looks like an ATS/job-board URL rather than trying to
// perfectly classify every domain — a miss just means the optional
// sameAs/logo fields are omitted.
const ATS_HOST_PATTERN = /peopleadmin|myworkdayjobs|taleo|icims|interfolio|pageuptalent|schooljobs|neogov|paycomonline|silkroad|^jobs\./i;
const ATS_PATH_PATTERN = /\/(careers?|jobs?|postings?|apply|employment|recruit(ing)?)(\/|$|\?)/i;

function looksLikeJobBoardUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    return ATS_HOST_PATTERN.test(u.hostname) || ATS_PATH_PATTERN.test(u.pathname);
  } catch {
    return true; // malformed URL — not trustworthy either
  }
}

export function buildInstitutionIndex(institutionsMasterPath) {
  const index = new Map();
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(institutionsMasterPath, "utf8"));
  } catch {
    return index;
  }
  // File shape is { generatedAt, source, counts, institutions: [...] }, not a
  // bare array.
  const list = Array.isArray(parsed) ? parsed : parsed?.institutions;
  if (!Array.isArray(list)) return index;
  for (const inst of list) {
    // homepage_url is unreliable outside "healthy" records — for most of the
    // rest it's been overwritten with a career/ATS application URL by earlier
    // pipeline stages (e.g. Columbia University's homepage_url is literally
    // an Interfolio application link). 1,246 of 1,584 records are flagged
    // "invalid" for exactly this reason, so treat anything less than
    // "healthy" as untrustworthy for sameAs/logo purposes.
    if (inst.verification_status !== "healthy" || !inst.homepage_url) continue;
    if (inst.homepage_url === inst.career_url) continue;
    if (looksLikeJobBoardUrl(inst.homepage_url)) continue;
    const keys = [inst.name, ...(inst.aliases || [])];
    for (const key of keys) {
      const norm = normalizeName(key);
      if (norm && !index.has(norm)) index.set(norm, inst);
    }
  }
  return index;
}

export function lookupInstitution(collegeName, index) {
  if (!collegeName) return null;
  return index.get(normalizeName(collegeName)) || null;
}
