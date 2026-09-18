import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// "contingent" alone is ordinary English ("contingent upon/on funding", "contingent
// on a background check") in the overwhelming majority of postings -- verified
// against the live dataset: of 165 unclassified postings where bare "contingent"
// collided with an explicit tenure-track description phrase and canceled it out to
// null, 164 were this generic usage and only 1 was genuine contingent-employment
// language. Require it to actually describe the appointment/employee.
// non[\s-]?tenured? (not just non[\s-]?tenure): several UT System institutions'
// own HOOP/IHOP policies use "Non-Tenured Research/Clinical/Instructional/Practice"
// (with a trailing "d") as their official non-tenure title suffix -- e.g. UTHealth
// Houston HOOP Policy 192: "Instructor, Non-Tenured Clinical (NTC)". The bare
// "non-tenure" alternative's \b boundary can't see past that "d" (both are word
// characters), so it silently missed this phrasing wherever it appears verbatim.
const NON_TENURE_RE = /\b(?:non[\s-]?tenured?(?:[\s-]?(?:track|accru(?:ing|al)|eligible))?|non[\s-]?tenurable|without\s+tenure|not\s+(?:a\s+)?tenure[\s-]?(?:track|eligible|accruing)|not\s+eligible\s+for\s+tenure|ntt|teaching[\s-]?track|instructional[\s-]?track|professional[\s-]?track|practice[\s-]?track|clinical[\s-]?track|research[\s-]?track|fixed[\s-]?term|term[\s-]?faculty|contingent\s+(?:faculty|appointment|position|employee|status|worker))\b/i;
const TENURE_RE = /\b(?:tenure[\s-]?(?:track|stream|eligible|accru(?:ing|al)|earning|line)|eligible\s+for\s+tenure|(?:appoint(?:ed|ment)|position|rank|role)\b.{0,40}\bwith\s+tenure|tenured)\b/i;

// Some sources render scraped text with two fields glued together, no space
// in between -- e.g. "...Tenure-TrackJob Number:...", "TENURE-TRACKAdvertising",
// "tenure trackFull Time". \b doesn't see a boundary at that junction since the
// letters on both sides are word characters regardless of case, so it was
// silently missing an explicit signal sitting right there in the text. Insert
// a space at a lower/digit->upper transition, or an ACRONYM->TitleCase one, so
// the phrase reads as its own word again. Genuine word-continuations like
// "tenure-tracked" or "non-tenure-tracking" have no case transition and are
// left untouched.
function insertConcatenationBoundaries(text) {
  return text.replace(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/g, " ");
}
// part\s*-?\s*time (not part[\s-]?time): some sources render the title as
// "Part - Time Instructor" with a full space on both sides of the hyphen
// (College of Southern Nevada, University of Washington, Austin Peay) --
// [\s-]? only ever allows one separator character, so it silently missed
// this "space-hyphen-space" spacing entirely. 72 unclassified jobs across
// those three colleges were sitting unrecognized for exactly this reason.
const CLEARLY_NON_TENURE_TITLE_RE = /\b(?:adjunct|visiting|post[\s-]?doc(?:toral)?|temporary|part\s*-?\s*time|professor\s+of\s+practice)\b/i;

// Many postings include a boilerplate "department overview" sentence stating the
// CURRENT SIZE of the department, not the track of the position being posted --
// e.g. "SMTD has 46 tenured and tenure-track faculty as well as 55 contract,
// continuing and adjunct faculty" (CSU Fort Collins), "The Department has 30
// tenured and tenure-track faculty..." (Texas A&M), "...with approximately 55
// tenured/tenure-track faculty, 22 academic professional track faculty members"
// (Virginia Tech). This phrasing is common across many institutions, not
// institution-specific. The bare "tenured"/"tenure-track" words inside it were
// being read as an explicit signal for the position itself (verified: nine CSU
// Fort Collins SMTD "Open Pool" instructor postings were stored as
// tenureTrack: true purely off this sentence, even though CSU's Faculty Manual
// defines the Instructor rank as never tenure-track). Strip this
// verb+headcount+"faculty" shape before testing for a signal either way -- a
// genuine per-position statement never takes this "has N ... faculty" form, it
// uses phrasing like "this is a tenure-track appointment" instead (see TENURE_RE
// above), so stripping it does not cost us any real signal. The trailing
// repeating group also absorbs a second enumerated headcount clause in the same
// sentence (e.g. Virginia Tech's "...55 tenured/tenure-track faculty, 22
// academic professional track faculty members") -- without it, that second
// clause's bare "professional track" would itself read as a false NON-tenure
// signal for the position.
const AGGREGATE_FACULTY_COUNT_CLAUSE = "(?:approximately\\s+)?\\d+(?:[\\s,\\/-]+(?:and\\s+|or\\s+)?(?:[A-Za-z][A-Za-z-]*|\\d+)){0,6}[\\s,\\/-]+faculty\\b(?:\\s+members?\\b)?";
const AGGREGATE_FACULTY_COUNT_RE = new RegExp(
  `\\b(?:currently\\s+)?(?:has|have|comprises?|comprised\\s+of|consists?\\s+of|consisting\\s+of|with)\\s+${AGGREGATE_FACULTY_COUNT_CLAUSE}` +
    `(?:\\s*(?:,|and|or)\\s*${AGGREGATE_FACULTY_COUNT_CLAUSE})*`,
  "gi"
);

// Structural ATS-metadata signals, not prose -- these are labeled fields a
// scraper concatenates into the description text verbatim (e.g. NEOGOV's
// "Salary $89.24 Hourly ... Job Type Part-Time Faculty ..."), not free-text
// claims about the appointment, so they don't fit explicitSignals'
// phrase-matching. An hourly (rather than annual/salary-scale) rate is
// definitional of part-time/adjunct employment across US higher ed --
// tenure-track faculty are never paid hourly -- and a labeled "Job Type" of
// Part-Time/Non-Credit Instructor/Associate Faculty is equally structural.
// Verified zero false positives against 707 (hourly) and 1,500 (job-type)
// already-correctly-classified non-tenure-track jobs before adding this;
// resolves 125 previously-unclassified jobs across 25+ community colleges
// (College of the Canyons, Skagit Valley, Loyola Maryland, Lake Land, and
// others) with no observed tenure-track false positives.
const HOURLY_SALARY_RE = /\bsalary\s+\$[\d.,]+\s*(?:-\s*\$[\d.,]+\s*)?hourly\b/i;
const NON_TENURE_JOB_TYPE_FIELD_RE =
  /\bjob\s*type\s+(?:part[\s-]?time(?:\s+(?:faculty|temporary|permanent|continuing education))?|non[\s-]?credit\s+instructors?|associate\s+faculty|staff\s+part\s*time)\b/i;

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
  const withConcatenationBoundaries = insertConcatenationBoundaries(String(raw || ""));
  // Remove department-composition headcount asides ("has 46 tenured and
  // tenure-track faculty...") before testing either direction -- they describe
  // the department, not the posted position.
  const text = withConcatenationBoundaries.replace(AGGREGATE_FACULTY_COUNT_RE, " ");
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

  const descriptionText = String(job.description || "");
  if (HOURLY_SALARY_RE.test(descriptionText) || NON_TENURE_JOB_TYPE_FIELD_RE.test(descriptionText)) {
    return { value: false, evidence: "description-job-type" };
  }

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
