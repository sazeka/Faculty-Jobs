import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// "contingent" alone is ordinary English ("contingent upon/on funding", "contingent
// on a background check") in the overwhelming majority of postings -- verified
// against the live dataset: of 165 unclassified postings where bare "contingent"
// collided with an explicit tenure-track description phrase and canceled it out to
// null, 164 were this generic usage and only 1 was genuine contingent-employment
// language. Require it to actually describe the appointment/employee.
const NON_TENURE_RE = /\b(?:non[\s-]?tenure(?:[\s-]?(?:track|accru(?:ing|al)|eligible))?|non[\s-]?tenurable|without\s+tenure|not\s+(?:a\s+)?tenure[\s-]?(?:track|eligible|accruing)|not\s+eligible\s+for\s+tenure|ntt|teaching[\s-]?track|instructional[\s-]?track|professional[\s-]?track|practice[\s-]?track|clinical[\s-]?track|research[\s-]?track|fixed[\s-]?term|term[\s-]?faculty|contingent\s+(?:faculty|appointment|position|employee|status|worker))\b/i;
const TENURE_RE = /\b(?:tenure[\s-]?(?:track|stream|eligible|accru(?:ing|al)|earning|line)|eligible\s+for\s+tenure|(?:appoint(?:ed|ment)|position|rank|role)\b.{0,40}\bwith\s+tenure|tenured)\b/i;
// part\s*-?\s*time (not part[\s-]?time): some sources render the title as
// "Part - Time Instructor" with a full space on both sides of the hyphen
// (College of Southern Nevada, University of Washington, Austin Peay) --
// [\s-]? only ever allows one separator character, so it silently missed
// this "space-hyphen-space" spacing entirely. 72 unclassified jobs across
// those three colleges were sitting unrecognized for exactly this reason.
const CLEARLY_NON_TENURE_TITLE_RE = /\b(?:adjunct|visiting|post[\s-]?doc(?:toral)?|temporary|part\s*-?\s*time|professor\s+of\s+practice)\b/i;

// Last-resort, per-institution title-convention overrides -- see
// data/institution-tenure-policy.json for the source-cited rules themselves.
// Each rule fires only for one specific college's own documented title
// convention, and only after every explicit signal above has come up empty.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INSTITUTION_POLICY_PATH = path.resolve(__dirname, "..", "..", "data", "institution-tenure-policy.json");

function loadInstitutionPolicyRules() {
  const byCollege = new Map();
  const patternRules = [];
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(INSTITUTION_POLICY_PATH, "utf8"));
  } catch {
    return { byCollege, patternRules };
  }
  for (const rule of Array.isArray(raw?.rules) ? raw.rules : []) {
    if (!rule?.titlePattern || typeof rule.value !== "boolean") continue;
    let titleRe;
    try {
      titleRe = new RegExp(rule.titlePattern, "i");
    } catch {
      continue;
    }
    // A rule names either one exact college ("college") or a group of colleges
    // sharing one documented, system-wide policy ("collegePattern", e.g. SUNY's
    // state-operated campuses) -- never both.
    if (rule.college) {
      const list = byCollege.get(rule.college) || [];
      list.push({ value: rule.value, titleRe });
      byCollege.set(rule.college, list);
    } else if (rule.collegePattern) {
      let collegeRe;
      try {
        collegeRe = new RegExp(rule.collegePattern);
      } catch {
        continue;
      }
      patternRules.push({ value: rule.value, titleRe, collegeRe });
    }
  }
  return { byCollege, patternRules };
}

const { byCollege: INSTITUTION_POLICY_RULES, patternRules: INSTITUTION_POLICY_PATTERN_RULES } =
  loadInstitutionPolicyRules();

function matchInstitutionPolicy(job) {
  const title = String(job?.title || "");
  const exactRules = INSTITUTION_POLICY_RULES.get(job?.college);
  if (exactRules) {
    for (const rule of exactRules) {
      if (rule.titleRe.test(title)) return { value: rule.value, evidence: "institution-policy" };
    }
  }
  const college = String(job?.college || "");
  for (const rule of INSTITUTION_POLICY_PATTERN_RULES) {
    if (rule.collegeRe.test(college) && rule.titleRe.test(title)) {
      return { value: rule.value, evidence: "institution-policy" };
    }
  }
  return null;
}

function explicitSignals(raw) {
  const text = String(raw || "");
  const nonTenure = NON_TENURE_RE.test(text);
  // Remove negative/alternative phrases before testing for a positive tenure
  // signal; otherwise "non-tenure-track" also matches "tenure-track".
  const positiveText = text.replace(new RegExp(NON_TENURE_RE.source, "gi"), " ");
  const tenure = TENURE_RE.test(positiveText);
  return { tenure, nonTenure };
}

export function classifyTenureTrackWithEvidence(job = {}) {
  const value = job.tenureTrack;
  if (value === true || value === false) {
    return { value, evidence: job.tenureEvidence || "stored" };
  }

  const status = String(value || "").toLowerCase().trim();
  const stored = explicitSignals(status);
  if (stored.nonTenure && !stored.tenure) return { value: false, evidence: job.tenureEvidence || "stored" };
  if (stored.tenure && !stored.nonTenure) return { value: true, evidence: job.tenureEvidence || "stored" };

  const title = String(job.title || "");
  const titleSignals = explicitSignals(title);
  if (titleSignals.nonTenure && !titleSignals.tenure) return { value: false, evidence: "title-explicit" };
  if (titleSignals.tenure && !titleSignals.nonTenure) return { value: true, evidence: "title-explicit" };

  // These ranks or appointment qualifiers are definitionally non-tenure-track.
  // Do not extend this shortcut to lecturer, instructor, clinical, research,
  // or professor generally: those can be on either track by institution.
  const rankText = `${title} ${job.positionType || ""}`;
  if (CLEARLY_NON_TENURE_TITLE_RE.test(rankText)) return { value: false, evidence: "title-rank" };

  const descriptionSignals = explicitSignals(job.description);
  if (descriptionSignals.nonTenure && !descriptionSignals.tenure) return { value: false, evidence: "description-explicit" };
  if (descriptionSignals.tenure && !descriptionSignals.nonTenure) return { value: true, evidence: "description-explicit" };

  const institutionMatch = matchInstitutionPolicy(job);
  if (institutionMatch) return institutionMatch;

  return { value: null, evidence: null };
}

export function classifyTenureTrack(job = {}) {
  return classifyTenureTrackWithEvidence(job).value;
}

export function computeTenureTrackBreakdown(jobs = []) {
  let tenureTrack = 0;
  let nonTenureTrack = 0;
  let unknown = 0;

  for (const job of jobs) {
    const classification = classifyTenureTrack(job);
    if (classification === true) tenureTrack++;
    else if (classification === false) nonTenureTrack++;
    else unknown++;
  }

  const classified = tenureTrack + nonTenureTrack;
  return {
    tenureTrack,
    nonTenureTrack,
    unknown,
    classified,
    tenureTrackPct: classified ? Number(((tenureTrack / classified) * 100).toFixed(1)) : 0,
    nonTenureTrackPct: classified ? Number(((nonTenureTrack / classified) * 100).toFixed(1)) : 0,
  };
}
