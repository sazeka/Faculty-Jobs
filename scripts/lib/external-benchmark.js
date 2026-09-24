import { canonicalInstitutionName } from "./institution-aliases.js";

const STOP_WORDS = new Set(["a", "an", "and", "at", "for", "in", "of", "or", "the", "to"]);

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function dateOnly(value) {
  const match = String(value || "").match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

export function titleTokens(value) {
  return new Set(
    clean(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((token) => token && !STOP_WORDS.has(token))
      .map((token) => ({ assistant: "asst", associate: "assoc", professor: "prof" })[token] || token)
  );
}

export function titleMatchScore(left, right) {
  const a = titleTokens(left);
  const b = titleTokens(right);
  if (!a.size || !b.size) return { score: 0, dice: 0, containment: 0 };
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  const dice = (2 * intersection) / (a.size + b.size);
  const containment = intersection / Math.min(a.size, b.size);
  return { score: Math.max(dice, containment), dice, containment };
}

function positionTypes(ad) {
  return (ad?.position_types || []).map((row) => clean(row?.name || row)).filter(Boolean);
}

function isEligibleEjmAd(ad, snapshotDate) {
  const isUs = (ad?.locations || []).some((location) => clean(location?.country_code).toUpperCase() === "US");
  const types = positionTypes(ad);
  const isFaculty = types.some((type) => /professor|lecturer/i.test(type));
  const isNonacademic = types.some((type) => /nonacademic/i.test(type));
  const start = dateOnly(ad?.startdate);
  const deadline = dateOnly(ad?.deadline_date);
  return isUs && isFaculty && !isNonacademic && (!start || start <= snapshotDate) && (!deadline || deadline >= snapshotDate);
}

function explicitTenureStatus(value) {
  const text = clean(value).toLowerCase();
  if (!text) return null;
  const negative = /non[-\s]?tenure(?:[-\s]?track)?|without tenure|not tenure[-\s]?track/;
  // An ad can describe an overall tenure-track search while separately
  // calling an associate-rank hire "without tenure" (meaning pre-tenure), as
  // MIT's 2026 economics ad does. Remove explicit negative phrases before
  // looking for an independent positive signal so that genuine mixed text is
  // not mislabeled solely by whichever phrase appears first.
  const positiveText = text.replace(new RegExp(negative.source, "g"), " ");
  if (/tenure[-\s]?track|tenured\b|tenure eligible/.test(positiveText)) return "tenure-track";
  if (negative.test(text)) return "non-tenure-track";
  return null;
}

function facultyAtlasTenureStatus(job) {
  const value = job?.tenureTrack;
  if (value === true || /^(true|tenure-track|tenured)$/i.test(clean(value))) return "tenure-track";
  if (value === false || /^(false|non-tenure-track)$/i.test(clean(value))) return "non-tenure-track";
  return explicitTenureStatus(`${job?.title || ""} ${job?.description || ""}`);
}

function pct(numerator, denominator) {
  return denominator ? Number(((numerator / denominator) * 100).toFixed(1)) : 0;
}

export function compareEconJobMarket({ ads, jobs, snapshotDate, includeDetails = false, matchThreshold = 0.8 }) {
  const snapshot = dateOnly(snapshotDate) || new Date().toISOString().slice(0, 10);
  const dedupe = new Set();
  const eligibleAds = (Array.isArray(ads) ? ads : [])
    .filter((ad) => isEligibleEjmAd(ad, snapshot))
    .filter((ad) => {
      const key = `${canonicalInstitutionName(ad?.name)}|${clean(ad?.adtitle).toLowerCase()}`;
      if (dedupe.has(key)) return false;
      dedupe.add(key);
      return true;
    });

  const usableJobs = (Array.isArray(jobs) ? jobs : []).filter((job) => clean(job?.college) && clean(job?.title));
  const institutionsInAtlas = new Set(usableJobs.map((job) => canonicalInstitutionName(job.college)));
  const pairs = [];
  for (let adIndex = 0; adIndex < eligibleAds.length; adIndex++) {
    const ad = eligibleAds[adIndex];
    const institution = canonicalInstitutionName(ad.name);
    for (let jobIndex = 0; jobIndex < usableJobs.length; jobIndex++) {
      const job = usableJobs[jobIndex];
      if (canonicalInstitutionName(job.college) !== institution) continue;
      const match = titleMatchScore(ad.adtitle, job.title);
      if (match.score < matchThreshold) continue;
      pairs.push({ adIndex, jobIndex, ...match });
    }
  }

  pairs.sort((a, b) => b.score - a.score || b.dice - a.dice || a.adIndex - b.adIndex);
  const usedAds = new Set();
  const usedJobs = new Set();
  const matches = [];
  for (const pair of pairs) {
    if (usedAds.has(pair.adIndex) || usedJobs.has(pair.jobIndex)) continue;
    usedAds.add(pair.adIndex);
    usedJobs.add(pair.jobIndex);
    const ad = eligibleAds[pair.adIndex];
    const job = usableJobs[pair.jobIndex];
    const benchmarkTenure = explicitTenureStatus(`${ad.adtitle || ""} ${ad.adtext || ""}`);
    const atlasTenure = facultyAtlasTenureStatus(job);
    matches.push({ ad, job, benchmarkTenure, atlasTenure, score: pair.score });
  }

  const adsAtCoveredInstitutions = eligibleAds.filter((ad) =>
    institutionsInAtlas.has(canonicalInstitutionName(ad.name))
  ).length;
  const evaluable = matches.filter((match) => match.benchmarkTenure && match.atlasTenure);
  const agreements = evaluable.filter((match) => match.benchmarkTenure === match.atlasTenure).length;

  const report = {
    benchmark: "EconJobMarket public open-ad feed",
    snapshotDate: snapshot,
    methodology: {
      scope: "Distinct active U.S. academic professor/lecturer advertisements",
      match: `Canonical institution plus one-to-one title token match >= ${matchThreshold}`,
      note: "External benchmark only; not independent two-coder validation.",
    },
    counts: {
      eligibleAds: eligibleAds.length,
      benchmarkInstitutions: new Set(eligibleAds.map((ad) => canonicalInstitutionName(ad.name))).size,
      adsAtAtlasInstitutions: adsAtCoveredInstitutions,
      matchedAds: matches.length,
      missingAds: eligibleAds.length - matches.length,
      evaluableTenureMatches: evaluable.length,
      tenureAgreements: agreements,
    },
    rates: {
      overallCoveragePercent: pct(matches.length, eligibleAds.length),
      coveredInstitutionCoveragePercent: pct(matches.length, adsAtCoveredInstitutions),
      tenureAgreementPercent: pct(agreements, evaluable.length),
    },
  };

  if (includeDetails) {
    report.matches = matches.map((match) => ({
      institution: canonicalInstitutionName(match.ad.name),
      benchmarkTitle: clean(match.ad.adtitle),
      benchmarkUrl: clean(match.ad.url) || null,
      atlasTitle: clean(match.job.title),
      atlasUrl: clean(match.job.url) || null,
      score: Number(match.score.toFixed(3)),
      benchmarkTenure: match.benchmarkTenure,
      atlasTenure: match.atlasTenure,
    }));
    report.missing = eligibleAds
      .filter((_, index) => !usedAds.has(index))
      .map((ad) => ({
        institution: canonicalInstitutionName(ad.name),
        title: clean(ad.adtitle),
        benchmarkUrl: clean(ad.url) || null,
        deadline: dateOnly(ad.deadline_date),
        institutionPresentInAtlas: institutionsInAtlas.has(canonicalInstitutionName(ad.name)),
      }));
  }

  return report;
}
