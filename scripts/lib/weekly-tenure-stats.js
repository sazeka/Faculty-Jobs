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
const NON_TENURE_RE = /\b(?:non[\s-]?tenured?(?:[\s-]?(?:track|accru(?:ing|al)|eligible))?|non[\s-]?tenurable|without\s+tenure|not\s+(?:a\s+)?tenure[\s-]?(?:track|eligible|accruing)|not\s+eligible\s+for\s+tenure|ineligible\s+for\s+tenure|outside\s+(?:the\s+)?tenure\s+structure|ntt|teaching[\s-]?track|instructional[\s-]?track|professional[\s-]?track|practice[\s-]?track|clinical[\s-]?track|research[\s-]?track|career[\s-]?track\s+(?:(?:faculty|teaching)\s+)?(?:appointment|position)|fixed[\s-]?term|this\s+is\s+(?:a\s+)?term\s+position|temporary\s+replacement|temporary\s+position\s*\(\s*not\s+to\s+exceed\s+\d+\s+years?|limited[\s-]?term\s+(?:faculty\s+)?(?:appointment|position)|time[\s-]?limited\s+(?:faculty\s+)?(?:appointment|position)(?!\s*:?\s*no\b)|renewable\s+term(?:\s+(?:appointment|position))?|(?:one|two|three|1|2|3)[\s-]year\s+(?:full[\s-]time\s+)?(?:(?:faculty|academic|teaching\s+professor|lecturer|instructor|professor)\s+)?(?:appointments?|positions?|terms?)|initial\s+(?:[a-z/-]+\s+){0,3}contract\s+is\s+\d+(?:\s*-\s*\d+)?\s+years?|(?:initial\s+)?appointment\s+is\s+for\s+a\s+term\s+of\s+up\s+to\s+(?:one|two|three|\d+)\s+years?|term[\s-]?faculty|contingent\s+(?:faculty|appointment|position|employee|status|worker))\b/i;
const TENURE_RE = /\b(?:pre[\s-]?tenure|tenure[\s-]+(?:track|stream|eligible|accru(?:ing|al)|earning|line|pathway|leading|bearing)|tenure(?=\s+or\s+career[\s-]?track)|eligible\s+for\s+(?:award\s+of\s+)?tenure|tenure\s+contract\s+eligible|security\s+of\s+employment\s*\(\s*equivalent\s+to\s+tenure\s*\)|continuing\s+appointment\s*\(\s*tenure\s*\)|(?:appoint(?:ed|ment)|position|rank|role)\b.{0,40}\bwith\s+tenure|tenured)(?=\W|$)/i;
const CLEARLY_TENURE_TITLE_RE = /\bwith\s+tenure\b/i;

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
  return text
    // Normalize typographic/nonbreaking separators before applying the ASCII
    // appointment-language patterns. Several direct postings use U+2011
    // nonbreaking hyphens in "non‑tenure‑track", which otherwise looks
    // identical in the UI but never matches [\s-].
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\u00a0/g, " ")
    .replace(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/g, " ");
}
// part\s*-?\s*time (not part[\s-]?time): some sources render the title as
// "Part - Time Instructor" with a full space on both sides of the hyphen
// (College of Southern Nevada, University of Washington, Austin Peay) --
// [\s-]? only ever allows one separator character, so it silently missed
// this "space-hyphen-space" spacing entirely. 72 unclassified jobs across
// those three colleges were sitting unrecognized for exactly this reason.
const CLEARLY_NON_TENURE_TITLE_RE = /\badj\.\s+(?:faculty|instructor|lecturer|professor)\b|\b(?:adjunct|visiting|post[\s-]?doc(?:toral)?|fellow|temporary|limited[\s-]?term|part\s*-?\s*time|half\s*-?\s*time|professor\s+of\s+practice|(?:assistant|associate|full)?\s*professor[\s-]+in[\s-]+residence|wot|affiliate\s+(?:faculty|instructor|lecturer|professor)|per\s+diem|non[\s-]?compensated|contract(?:ual)?\s+(?:faculty|instructor|lecturer)|acting\s+(?:assistant|associate|full)?\s*professor|substitute\b.{0,45}\binstructors?|restricted(?:\s+\d+[\s-]month)?\s+faculty|on[\s-]call|hourly\b.{0,35}\b(?:faculty|instructor|lecturer)|non[\s-]?credit\b.{0,35}\binstructors?)\b|\binstructors?\b.{0,35}\bnon[\s-]?credit\b|\bterm(?:\s*[-,]\s*|\s+)(?:assistant|associate|full)?\s*(?:professor|faculty|lecturer|instructor)\b|\b(?:assistant|associate|full)?\s*(?:professor|faculty|lecturer|instructor)\b(?:\s+\d+)?(?:\s*[-,]\s*|\s+)term\b|\b(?:instructors?|lecturers?)\b.{0,45}\b(?:applicant\s+)?pool(?:\s+posting)?\b|\bpool\s+posting\b.{0,45}\b(?:instructors?|lecturers?)\b|\b(?:instructors?\b.{0,45}\bsummer|summer\b.{0,45}\binstructors?)\b/i;
const PART_TIME_TITLE_ABBREVIATION_RE =
  /\b(?:faculty|instructors?|lecturers?|professors?)\b.{0,45}\bp\s*\/\s*t\b|\bp\s*\/\s*t\b.{0,45}\b(?:faculty|instructors?|lecturers?|professors?)\b/i;
const FLEXIBLE_FULL_OR_PART_TIME_TITLE_RE = /\bf\s*\/\s*t\b.{0,20}\bor\s+p\s*\/\s*t\b/i;

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
  `\\b(?:currently\\s+)?(?:has|have|comprises?|comprised\\s+of|consists?\\s+of|consisting\\s+of|with|(?:a\\s+)?group\\s+of)\\s+${AGGREGATE_FACULTY_COUNT_CLAUSE}` +
    `(?:\\s*(?:,|and|or)\\s*${AGGREGATE_FACULTY_COUNT_CLAUSE})*`,
  "gi"
);

// Coastal Carolina's standard visa paragraph says that the university rarely
// sponsors several broad classes of jobs, including "non-tenure-track roles."
// That is an immigration-policy statement, not the track of the opening. Strip
// only this sponsorship sentence so an explicit statement later in the posting
// (for example, "a Tenure-Track Assistant Professor") remains decisive.
const VISA_SPONSORSHIP_TRACK_BOILERPLATE_RE =
  /\b[^.]{0,80}\brarely\s+sponsors?\b[^.]{0,180}\bnon[\s-]?tenure[\s-]?track\s+roles?\b[^.]*\.?/gi;

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
const HOURLY_SALARY_RE = /\b(?:salary\s+\$[\d.,]+\s*(?:-\s*\$[\d.,]+\s*)?hourly|(?:expected\s+)?hourly\s+rate\s*:?\s*\$[\d.,]+|pay\s+basis\s*:?\s*hourly)\b|\$\s*\d[\d,.]*(?:\s*-\s*\$?\s*\d[\d,.]*)?\s*(?:per\s+(?:hours?|courses?|credits?(?:\s+hours?)?|contact\s+hours?)|\/\s*(?:hours?|hrs?|courses?|credits?)\b)/i;
const NON_TENURE_JOB_TYPE_FIELD_RE =
  /\bjob\s*type\s*:?\s*(?:part[\s-]?time(?:\s+(?:faculty|temporary|permanent|continuing education|staff(?:\s+term)?))?|faculty\s*-\s*part[\s-]?time|non[\s-]?credit\s+instructors?|associate\s+faculty|staff\s+part\s*time)\b|\b(?:ft\s*\/\s*pt|full(?:[\s-]*time)?\s*\/\s*part[\s-]*time|full\s+or\s+part[\s-]?time|position\s+(?:time\s+status|type)|time\s+type|work\s+type|work\s+schedule|job\s+status)\s*:?\s*part[\s-]?time\b|\b(?:position|work)\s+type\s*:?\s*(?:adjunct\s+faculty|temporary(?:\s+grant[^,.;]*)?|pt)\b|\bemployee\s+category\s*:?\s*part[\s-]?time(?:\s+staff)?\b|\bjob\s+category\s*:?\s*non[\s-]?employee\s+instructor\b|\b(?:employment|appointment|position)\s+(?:type|category)\s*:?\s*(?:part[\s-]?time|temporary|seasonal)\b|\bregular\s*\/\s*temporary\s*:?\s*temporary\b|\btemporary\s+or\s+permanent\s*:?\s*temporary\b|\bclassification\s*:?\s*temporary\b|\bcontracted\s+part[\s-]?time\s+faculty\b/i;

// A small number of PDF and ATS sources omit appointment qualifiers from the
// scraped title/description even though the direct posting filename still
// contains them (for example, `English_Instructor_PT_07.26.pdf` or
// `Assistant-Professor--Non-tenure-Track_R0007906`). Treat only the final URL
// path segment as title-like evidence (or the preceding segment when the final
// one is only a numeric job ID); ignoring the host, other parent directories,
// query string, and fragment prevents unrelated navigation text from leaking
// into classification. This is deliberately a final fallback, so a stale URL
// can never override a stored value or an explicit statement in the posting.
function sourceUrlAppointmentSignal(rawUrl) {
  let filename;
  try {
    const pathname = decodeURIComponent(new URL(String(rawUrl || "")).pathname);
    const segments = pathname.split("/").filter(Boolean);
    filename = segments.at(-1) || "";
    if (/^\d+$/.test(filename)) filename = segments.at(-2) || "";
  } catch {
    return null;
  }

  const nonTenurePattern =
    /non(?:[\s_-]*tenure)(?:[\s_-]*track)|adjunct|part[\s_-]+time|(?:^|[-_.])pt(?:[-_.]|$)|(?:^|[-_.])temp(?:[-_.]|$)/i;
  const hasNonTenure = nonTenurePattern.test(filename);
  const positiveFilename = filename.replace(new RegExp(nonTenurePattern.source, "gi"), " ");
  const hasTenure = /(?:^|[\s_-])tenure[\s_-]+track(?:[\s_.-]|$)/i.test(positiveFilename);
  if (hasNonTenure && !hasTenure) return false;
  if (hasTenure && !hasNonTenure) return true;
  return null;
}

// Labeled ATS fields describe this opening and should take precedence over
// generic prose elsewhere on the page. Without this pass, a decisive field
// such as "Tenure Track Status: Non-Tenure Track" can be cancelled by an
// unrelated mention of a department's tenure policy later in the description.
// Keep these patterns tightly anchored to labels observed in source records;
// free-form prose with both tracks remains deliberately ambiguous.
const TRACK_CHOICE_LABEL = "(?:is\\s+this\\s+position\\s+)?tenure\\s+track\\s+or\\s+non[\\s-]?tenure\\s+track\\??";
const STRUCTURED_NON_TENURE_RE = new RegExp(
  `(?:\\btenure\\s+track\\s+status\\s*:?\\s*|\\b${TRACK_CHOICE_LABEL}\\s*:?\\s*|\\btenure\\s*\\/\\s*non[\\s-]?tenure\\s+track\\s*:?\\s*)non[\\s-]?tenure\\s+track\\b` +
    `|\\b(?:faculty\\s+)?tenure[\\s-]+track(?:\\s+status)?\\s*:?\\s*(?:no|non[\\s-]?tenure(?:[\\s-]?track)?)\\b` +
    `|\\btenure\\s+status\\s*:?\\s*(?:term|non[\\s-]?tenure(?:[\\s-]?track)?)\\b` +
    `|\\btenure\\s*:\\s*ineligible\\b` +
    `|\\bappointment\\s+status\\s*:?\\s*non[\\s-]?tenure(?:[\\s-]?track)?\\b` +
    `|\\bfaculty\\s+type\\s+of\\s+position\\s*:?\\s*term\\b` +
    `|\\bposition\\s+category\\s*:?\\s*faculty\\s*-\\s*term\\s+appointment\\b` +
    `|\\bappointment\\s+type\\s*:?\\s*time[\\s-]?limited\\b` +
    `|\\bappointment\\s+type\\s*:?\\s*term\\s*[-–]\\s*\\d+\\s+years?\\b` +
    `|\\bappointment\\s+term\\s*:?\\s*term\\b` +
    `|\\bemployment\\s+type\\s*:?\\s*terminal\\s*\\(\\s*fixed[\\s-]?term\\s*\\)` +
    `|\\bposition\\s+status\\s*:?\\s*limited[\\s-]?term\\b` +
    `|\\bjob\\s+type\\s*:?\\s*temporary\\b` +
    `|\\btime[\\s-]?limited\\s+position\\s*:?\\s*yes\\b` +
    `|\\btype\\s+of\\s+position\\s*:?\\s*faculty\\s*-\\s*non[\\s-]?tenure\\b` +
    `|\\bposition\\s+type\\s*:?\\s*non[\\s-]?tenure[\\s-]?track\\s+faculty\\b`,
  "i"
);
const STRUCTURED_TENURE_RE = new RegExp(
  `(?:\\btenure[\\s-]+track\\s+status\\s*:?\\s*|\\b${TRACK_CHOICE_LABEL}\\s*:?\\s*|\\btenure\\s*\\/\\s*non[\\s-]?tenure\\s+track\\s*:?\\s*)tenure[\\s-]+track\\b` +
    `|\\b(?:faculty\\s+)?tenure[\\s-]+track(?:\\s+status)?\\s*:?\\s*yes\\b` +
    `|\\btenure\\s+status\\s*:?\\s*tenure\\s+track\\b` +
    `|\\bappointment\\s+status\\s*:?\\s*tenure(?:\\s+track)?\\b` +
    `|\\bappointment\\s+type\\s*:?\\s*tenured\\s*\\/\\s*tenure\\s+track\\b` +
    `|\\btype\\s+of\\s+position\\s*:?\\s*faculty\\s*-\\s*tenure(?:\\s*\\/\\s*tenure\\s+track)?\\b` +
    `|\\bgroup\\s*:?\\s*tenure\\s+system\\s+faculty\\b` +
    `|\\bposition\\s+type\\s*:?\\s*tenured\\s*\\/\\s*tenure[\\s-]?track\\s+faculty\\b`,
  "i"
);

function structuredAppointmentSignal(raw) {
  const text = insertConcatenationBoundaries(String(raw || ""));
  const nonTenure = STRUCTURED_NON_TENURE_RE.test(text);
  // Remove a matched negative field before looking for the positive answer;
  // "Non-Tenure Track" necessarily contains the words "Tenure Track".
  const positiveText = text.replace(new RegExp(STRUCTURED_NON_TENURE_RE.source, "gi"), " ");
  const tenure = STRUCTURED_TENURE_RE.test(positiveText);
  if (nonTenure && !tenure) return false;
  if (tenure && !nonTenure) return true;
  return null;
}

// Last-resort, per-institution title-convention overrides -- see
// data/institution-tenure-policy.json for the source-cited rules themselves.
// Each rule fires only for one specific college's own documented title
// convention, and only after every explicit signal above has come up empty.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INSTITUTION_POLICY_PATH = path.resolve(__dirname, "..", "..", "data", "institution-tenure-policy.json");
const IPEDS_RANK_POLICY_PATH = path.resolve(__dirname, "..", "..", "data", "ipeds-rank-tenure-policy.json");

function loadInstitutionPolicyRules() {
  const byCollege = new Map();
  const patternRules = [];
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(INSTITUTION_POLICY_PATH, "utf8"));
  } catch {
    return { byCollege, patternRules };
  }
  for (const policy of Array.isArray(raw?.noTenureInstitutions) ? raw.noTenureInstitutions : []) {
    if (!policy?.college) continue;
    const list = byCollege.get(policy.college) || [];
    list.push({ value: false, titleRe: /^/, descriptionRe: null, urlRe: null });
    byCollege.set(policy.college, list);
  }
  for (const rule of Array.isArray(raw?.rules) ? raw.rules : []) {
    if (!rule?.titlePattern || typeof rule.value !== "boolean") continue;
    let titleRe;
    let descriptionRe = null;
    let urlRe = null;
    try {
      titleRe = new RegExp(rule.titlePattern, "i");
      if (rule.descriptionPattern) descriptionRe = new RegExp(rule.descriptionPattern, "i");
      if (rule.urlPattern) urlRe = new RegExp(rule.urlPattern, "i");
    } catch {
      continue;
    }
    // A rule names either one exact college ("college") or a group of colleges
    // sharing one documented, system-wide policy ("collegePattern", e.g. SUNY's
    // state-operated campuses) -- never both.
    if (rule.college) {
      const list = byCollege.get(rule.college) || [];
      list.push({ value: rule.value, titleRe, descriptionRe, urlRe });
      byCollege.set(rule.college, list);
    } else if (rule.collegePattern) {
      let collegeRe;
      try {
        collegeRe = new RegExp(rule.collegePattern);
      } catch {
        continue;
      }
      patternRules.push({ value: rule.value, titleRe, descriptionRe, urlRe, collegeRe });
    }
  }
  return { byCollege, patternRules };
}

const { byCollege: INSTITUTION_POLICY_RULES, patternRules: INSTITUTION_POLICY_PATTERN_RULES } =
  loadInstitutionPolicyRules();

function loadInstitutionVariablePolicyRules() {
  const rules = [];
  try {
    const raw = JSON.parse(fs.readFileSync(INSTITUTION_POLICY_PATH, "utf8"));
    for (const rule of Array.isArray(raw?.rules) ? raw.rules : []) {
      if (rule?.value !== "variable" || !rule?.titlePattern) continue;
      const titleRe = new RegExp(rule.titlePattern, "i");
      const descriptionRe = rule.descriptionPattern ? new RegExp(rule.descriptionPattern, "i") : null;
      const urlRe = rule.urlPattern ? new RegExp(rule.urlPattern, "i") : null;
      const collegeRe = rule.collegePattern ? new RegExp(rule.collegePattern) : null;
      rules.push({ college: rule.college || null, collegeRe, titleRe, descriptionRe, urlRe });
    }
  } catch {
    // Explicit prose patterns below remain available if optional policy data
    // is omitted or malformed in a stripped-down environment.
  }
  return rules;
}

const INSTITUTION_VARIABLE_POLICY_RULES = loadInstitutionVariablePolicyRules();

function matchesInstitutionVariablePolicy(job) {
  const college = String(job?.college || "");
  const title = String(job?.title || "");
  const description = String(job?.description || "");
  const url = String(job?.url || "");
  return INSTITUTION_VARIABLE_POLICY_RULES.some(
    (rule) =>
      (rule.college ? college === rule.college : rule.collegeRe?.test(college)) &&
      rule.titleRe.test(title) &&
      (!rule.descriptionRe || rule.descriptionRe.test(description)) &&
      (!rule.urlRe || rule.urlRe.test(url))
  );
}

function loadIpedsRankPolicyRules() {
  const rules = new Map();
  try {
    const raw = JSON.parse(fs.readFileSync(IPEDS_RANK_POLICY_PATH, "utf8"));
    for (const entry of Array.isArray(raw?.entries) ? raw.entries : []) {
      if (!entry?.college || !entry?.title || typeof entry.value !== "boolean") continue;
      rules.set(`${entry.college}\u0000${entry.title}`, entry.value);
    }
  } catch {
    // The classifier remains usable in stripped-down environments that omit
    // optional policy data; explicit posting language still takes precedence.
  }
  return rules;
}

const IPEDS_RANK_POLICY_RULES = loadIpedsRankPolicyRules();

function matchInstitutionPolicy(job) {
  const title = String(job?.title || "");
  const description = String(job?.description || "");
  const url = String(job?.url || "");
  const exactRules = INSTITUTION_POLICY_RULES.get(job?.college);
  if (exactRules) {
    for (const rule of exactRules) {
      if (
        rule.titleRe.test(title) &&
        (!rule.descriptionRe || rule.descriptionRe.test(description)) &&
        (!rule.urlRe || rule.urlRe.test(url))
      ) {
        return { value: rule.value, evidence: "institution-policy" };
      }
    }
  }
  const college = String(job?.college || "");
  for (const rule of INSTITUTION_POLICY_PATTERN_RULES) {
    if (
      rule.collegeRe.test(college) &&
      rule.titleRe.test(title) &&
      (!rule.descriptionRe || rule.descriptionRe.test(description)) &&
      (!rule.urlRe || rule.urlRe.test(url))
    ) {
      return { value: rule.value, evidence: "institution-policy" };
    }
  }
  const ipedsValue = IPEDS_RANK_POLICY_RULES.get(`${college}\u0000${title}`);
  if (typeof ipedsValue === "boolean") {
    return { value: ipedsValue, evidence: "institution-policy" };
  }
  return null;
}

function explicitSignals(raw) {
  const withConcatenationBoundaries = insertConcatenationBoundaries(String(raw || ""));
  // Remove department-composition headcount asides ("has 46 tenured and
  // tenure-track faculty...") before testing either direction -- they describe
  // the department, not the posted position.
  const text = withConcatenationBoundaries
    .replace(AGGREGATE_FACULTY_COUNT_RE, " ")
    .replace(VISA_SPONSORSHIP_TRACK_BOILERPLATE_RE, " ");
  const mixedTenureCareerTrack = /\btenure\s+or\s+career[\s-]?track\b/i.test(text);
  const nonTenure = NON_TENURE_RE.test(text) || mixedTenureCareerTrack;
  // Remove negative/alternative phrases before testing for a positive tenure
  // signal; otherwise "non-tenure-track" also matches "tenure-track".
  const positiveText = text.replace(new RegExp(NON_TENURE_RE.source, "gi"), " ");
  const tenure = TENURE_RE.test(positiveText) || mixedTenureCareerTrack;
  return { tenure, nonTenure };
}

// A posting's direct opening claim is stronger evidence than later contextual
// prose about other faculty tracks. Examples in the live data include
// "invites applications for a tenure-track faculty position" followed by a
// department overview mentioning non-tenure faculty, and "This is a ranked
// non-tenure-track faculty position" followed by promotion-policy text that
// mentions tenure. Keep this deliberately grammatical and local: it must name
// the opening/application and end in position/appointment. If the same clause
// offers both tracks ("tenure-track or non-tenure-track position"), its signals
// conflict and it remains unknown.
const DIRECT_APPOINTMENT_CLAIM_RE =
  /\b(?:invites?\s+applications?\s+for|this\s+is|these\s+are|the\s+(?:faculty\s+)?position\s+is)\b[^.]{0,180}\b(?:non[\s-]?tenured?(?:[\s-]?track)?|tenure[\s-]?(?:track|earning|eligible))\b[^.]{0,100}\b(?:positions?|appointments?)\b/gi;
const DIRECT_THIS_TRACK_POSITION_RE =
  /\bthis\s+(?:is\s+)?(?:an?\s+)?(?:non[\s-]?tenured?(?:[\s-]?track)?|tenure[\s-]?(?:track|earning|eligible)|fixed[\s-]?term|clinical[\s-]?track|professional[\s-]?track)\b[^.]{0,180}\b(?:positions?|appointments?)\b/gi;
const DIRECT_ADJUNCT_ROLE_RE =
  /\b(?:this\s+is\s+(?:an?\s+)?|(?:college|university|department|program)\s+is\s+seeking\s+(?:(?:applications?\s+from|applicants?\s+for|qualified)\s+)?(?:an?\s+)?|we\s+are\s+seeking\s+(?:an?\s+)?)\s*(?:part[\s-]?time\s+)?adjunct\s+(?:faculty|instructor|lecturer|professor|appointment|position)\b/i;
const DIRECT_PART_TIME_ROLE_RE =
  /\b(?:summary\s*:?|this\s+(?:is|position\s+is)|we\s+are\s+seeking|(?:college|department|center|program)\s+is\s+seeking)\b[^.]{0,100}\bpart[\s-]?time\b[^.]{0,100}\b(?:faculty|instructors?|lecturers?|professors?|appointments?|positions?)\b/gi;

function directDescriptionAppointmentSignal(raw) {
  const text = insertConcatenationBoundaries(String(raw || ""));
  if (DIRECT_ADJUNCT_ROLE_RE.test(text)) return false;
  for (const match of text.matchAll(DIRECT_PART_TIME_ROLE_RE)) {
    // Some full-time tenure appointments allow an 80-100% schedule and say
    // "full or part time". That describes workload flexibility, not a
    // part-time faculty classification.
    if (!/\bfull[\s-]?time\s+or\s+part[\s-]?time\b/i.test(match[0])) return false;
  }
  let value = null;
  for (const match of text.matchAll(new RegExp(`${DIRECT_APPOINTMENT_CLAIM_RE.source}|${DIRECT_THIS_TRACK_POSITION_RE.source}`, "gi"))) {
    const signals = explicitSignals(match[0]);
    const current = signals.nonTenure === signals.tenure ? null : signals.tenure;
    if (current === null) continue;
    if (value !== null && value !== current) return null;
    value = current;
  }
  return value;
}

export function classifyTenureTrackWithEvidence(job = {}) {
  const value = job.tenureTrack;
  const title = String(job.title || "");
  const titleSignals = explicitSignals(title);
  if (titleSignals.nonTenure && !titleSignals.tenure) return { value: false, evidence: "title-explicit" };
  if (titleSignals.tenure && !titleSignals.nonTenure) return { value: true, evidence: "title-explicit" };
  if (CLEARLY_TENURE_TITLE_RE.test(title)) return { value: true, evidence: "title-explicit" };

  // These ranks or appointment qualifiers are definitionally non-tenure-track.
  // Do not extend this shortcut to lecturer, instructor, clinical, research,
  // or professor generally: those can be on either track by institution.
  const rankText = `${title} ${job.positionType || ""}`;
  if (CLEARLY_NON_TENURE_TITLE_RE.test(rankText)) return { value: false, evidence: "title-rank" };
  if (
    PART_TIME_TITLE_ABBREVIATION_RE.test(rankText) &&
    !FLEXIBLE_FULL_OR_PART_TIME_TITLE_RE.test(rankText)
  ) {
    return { value: false, evidence: "title-rank" };
  }

  const descriptionSignals = explicitSignals(job.description);
  const structuredDescription = structuredAppointmentSignal(job.description);
  const directDescription = directDescriptionAppointmentSignal(job.description);
  const descriptionText = insertConcatenationBoundaries(String(job.description || ""));

  // The current posting is stronger evidence than a carried-forward stored
  // boolean or an institution-wide title convention. When a stored boolean is
  // present, override it only with one-directional explicit posting language,
  // a direct opening claim, or a structured field that is not contradicted by
  // the posting itself. This avoids treating weak ATS text such as
  // "Appointment Term: Term" as stronger than an explicit tenure-track claim.
  if (value === true || value === false) {
    if (descriptionSignals.nonTenure && !descriptionSignals.tenure) {
      return { value: false, evidence: "description-explicit" };
    }
    if (descriptionSignals.tenure && !descriptionSignals.nonTenure) {
      return { value: true, evidence: "description-explicit" };
    }
    if (directDescription !== null) {
      return { value: directDescription, evidence: "description-direct-claim" };
    }
    if (
      structuredDescription !== null &&
      !(structuredDescription === false && descriptionSignals.tenure) &&
      !(structuredDescription === true && descriptionSignals.nonTenure)
    ) {
      return { value: structuredDescription, evidence: "description-structured-field" };
    }
    if (HOURLY_SALARY_RE.test(descriptionText) || NON_TENURE_JOB_TYPE_FIELD_RE.test(descriptionText)) {
      return { value: false, evidence: "description-job-type" };
    }
    const institutionMatch = matchInstitutionPolicy(job);
    if (institutionMatch && institutionMatch.value !== value) return institutionMatch;
    return { value, evidence: job.tenureEvidence || "stored" };
  }

  if (structuredDescription !== null) {
    return { value: structuredDescription, evidence: "description-structured-field" };
  }
  if (descriptionSignals.nonTenure && !descriptionSignals.tenure) return { value: false, evidence: "description-explicit" };
  if (descriptionSignals.tenure && !descriptionSignals.nonTenure) return { value: true, evidence: "description-explicit" };
  if (directDescription !== null) {
    return { value: directDescription, evidence: "description-direct-claim" };
  }

  if (HOURLY_SALARY_RE.test(descriptionText) || NON_TENURE_JOB_TYPE_FIELD_RE.test(descriptionText)) {
    return { value: false, evidence: "description-job-type" };
  }

  const status = String(value || "").toLowerCase().trim();
  const stored = explicitSignals(status);
  if (stored.nonTenure && !stored.tenure) return { value: false, evidence: job.tenureEvidence || "stored" };
  if (stored.tenure && !stored.nonTenure) return { value: true, evidence: job.tenureEvidence || "stored" };

  const sourceUrlSignal = sourceUrlAppointmentSignal(job.url);
  if (sourceUrlSignal !== null) return { value: sourceUrlSignal, evidence: "source-url-explicit" };

  const institutionMatch = matchInstitutionPolicy(job);
  if (institutionMatch) return institutionMatch;

  return { value: null, evidence: null };
}

export function classifyTenureTrack(job = {}) {
  return classifyTenureTrackWithEvidence(job).value;
}

// Some searches explicitly leave the eventual appointment track open: they
// offer tenure and non-tenure alternatives, label the field "Open Tenure", or
// say the track will be selected from the candidate's rank/qualifications.
// Those records are not missing evidence and should not inflate the truly
// unclassified count, but they also must not enter the binary percentages.
const VARIABLE_TRACK_RE = new RegExp(
  [
    "\\b(?:this|the|these)\\s+(?:faculty\\s+)?(?:position|appointment)s?\\b[^.]{0,180}\\btenure[\\s-]?track\\b[^.]{0,80}\\b(?:or|and)\\b[^.]{0,80}\\bnon[\\s-]?tenure(?:[\\s-]?track)?\\b",
    "\\b(?:this|the|these)\\s+(?:faculty\\s+)?(?:position|appointment)s?\\b[^.]{0,180}\\bnon[\\s-]?tenure(?:[\\s-]?track)?\\b[^.]{0,80}\\b(?:or|and)\\b[^.]{0,80}\\btenure[\\s-]?track\\b",
    "\\b(?:rank\\s+and\\s+)?tenure[\\s-]+status\\b[^.]{0,180}\\b(?:depend|dependent|depends|determined|negotiable|negotibale|commensurate)\\b[^.]{0,180}\\b(?:qualifications?|credentials?|experience)\\b",
    "\\btenure\\s+eligibility\\b[^.]{0,120}\\b(?:dependent|depends|determined|negotiable|commensurate)\\b[^.]{0,120}\\b(?:qualifications?|credentials?|experience)\\b",
    "\\bacademic\\s+rank,?\\s+track,?\\s+tenure\\s+status\\b[^.]{0,100}\\b(?:depend|dependent|depends)\\b[^.]{0,80}\\bqualifications?\\b",
    "\\b(?:academic\\s+)?rank\\s+and\\s+(?:academic\\s+|appointment\\s+)?track\\b[^.]{0,100}\\b(?:will\\s+be\\s+)?(?:dependent|depends|determined|negotiable|commensurate)\\b[^.]{0,100}\\b(?:qualifications?|credentials?|experience|record)\\b",
    "\\b(?:please\\s+)?include\\s+the\\s+rank\\s+and\\s+track\\s+you\\s+are\\s+applying\\s+for\\b",
    "\\b(?:fixed[\\s-]?term|variable\\s+track)\\b[^.]{0,100}\\btenure(?:d|[\\s-]?track)\\b",
    "\\btenure(?:d|[\\s-]?track)\\b[^.]{0,100}\\b(?:fixed[\\s-]?term|variable\\s+track)\\b",
    "\\b(?:may|can|could)\\s+be\\s+(?:filled|offered|appointed)\\b[^.]{0,120}\\b(?:tenure(?:d|[\\s-]?track)|non[\\s-]?tenure(?:[\\s-]?track)?|clinical\\s+track)\\b[^.]{0,80}\\b(?:or|and)\\b[^.]{0,80}\\b(?:tenure(?:d|[\\s-]?track)|non[\\s-]?tenure(?:[\\s-]?track)?|clinical\\s+track)\\b",
    "\\btenure\\s+and\\s+non[\\s-]?tenure\\s+track\\s+will\\s+be\\s+considered\\b",
    "\\b(?:may|can|could|will)\\s+be\\s+(?:tenure|tenure[\\s-]?track|clinical[\\s-]?track)\\b[^.]{0,80}\\b(?:or|and)\\b[^.]{0,80}\\b(?:tenure|tenure[\\s-]?track|clinical[\\s-]?track)\\b",
    "\\btenure\\s+or\\s+career[\\s-]?track\\s+faculty\\s+position\\b",
    "\\bfull[\\s-]?time,?\\s+clinical[\\s-]?track\\s+or\\s+tenure[\\s-]?track\\s+faculty\\s+position\\b",
    "\\bLadder\\s+or\\s+combined\\s+Ladder\\s*\\/\\s*In[\\s-]?Residence\\s+Professor\\s+series\\b",
    "\\b(?:traditional|clinician[\\s-]?educator|clinician\\s+investigator)(?:\\s+track)?\\b[^.]{0,80}\\b(?:or|and)\\b[^.]{0,80}\\b(?:traditional|clinician[\\s-]?educator|clinician\\s+investigator)\\s+track\\b",
    "\\btenure\\s+(?:is\\s+)?preferred\\s+but\\s+not\\s+required\\b",
    "\\brank\\s+and\\s+tenure\\b[^.]{0,80}\\b(?:can|may|will)\\s+be\\s+(?:further\\s+)?(?:considered|determined)\\b[^.]{0,100}\\bqualified\\s+candidates?\\b",
    "\\btenure[\\s-]?eligibility,?\\s+and\\s+rank\\b[^.]{0,100}\\bcommensurate\\s+with\\s+experience\\b",
    "\\blecturer\\b[^.]{0,120}\\bnon[\\s-]?tenure\\s+track\\b[^.]{0,220}\\bassistant\\s+professor\\b[^.]{0,120}\\btenure\\s+track\\b",
    "\\b(?:open\\s+rank\\s+)?positions?\\s+(?:is|are)\\s+for\\s+either\\b[^.]{0,80}\\bnon[\\s-]?tenure\\s+track\\b[^.]{0,80}\\bor\\b[^.]{0,80}\\btenure\\s+track\\b",
    "\\b(?:applicants?|candidates?)\\b[\\s\\S]{0,400}\\beligible\\s+for\\s+appointment\\s+to\\s+a\\s+tenure[\\s-]?track\\s+position\\b[\\s\\S]{0,800}\\bcandidates?\\b[^.]{0,300}\\bnon[\\s-]?tenure[\\s-]?track\\s+appointment\\b",
    "\\bopen\\s+faculty\\s+search\\s*-\\s*small\\s+animal\\s+soft\\s+tissue\\s+surgery\\b[\\s\\S]{0,1800}\\btenure[\\s-]?track\\s+candidates?\\b[\\s\\S]{0,1800}\\bclinical\\s+track\\s+faculty\\b",
    "\\bassistant\\s+professor,?\\s+school\\s+of\\s+medicine,?\\s+neurosurgery\\b[\\s\\S]{0,1200}\\bfor\\s+tenure\\s+eligibility\\s+at\\s+the\\s+assistant\\s+professor\\s+rank\\b",
    "\\btracks?\\s*:?\\s*tenure[\\s-]?track,?\\s+tenured,?\\s+or\\s+non[\\s-]?tenure[\\s-]?track\\b",
    "\\beither\\s+(?:the\\s+)?tenure\\s+or\\s+clinical\\s+track\\b",
    "\\b(?:tenure|clinical)[\\s-]?track\\s*(?:/|or)\\s*(?:tenure|clinical)[\\s-]?track\\b[^.]{0,100}\\bfaculty\\s+position",
    "\\btenure\\s+or\\s+clinical\\s+track\\s+faculty\\s+positions?\\b",
    "\\bprofessional[\\s-]?track\\b[^.]{0,80}\\bor\\b[^.]{0,80}\\btenure[\\s-]?track\\b[^.]{0,100}\\bfaculty\\s+position\\b",
    "\\b(?:academic|clinician)\\s+track\\b[^.]{0,60}\\b(?:or|depending)\\b[^.]{0,60}\\b(?:academic|clinician)\\s+track\\b",
    "\\bopen\\s+track\\s*\\/\\s*open\\s+rank\\b[^.]{0,140}\\bappropriate\\s+track\\s+and\\s+rank\\s+will\\s+be\\s+determined\\b",
    "\\boffers\\s+both\\s+tenure\\s+track\\s+and\\s+term\\s+faculty\\s+contracts\\b[^.]{0,160}\\bdetermined\\s+based\\s+on\\s+the\\s+candidate",
    "\\b(?:position|appointment|applicants?|candidates?|ranked)\\b[^.]{0,160}\\btenure[\\s-]?track\\b[^.]{0,100}\\b(?:or|and)\\b[^.]{0,100}\\bnon[\\s-]?tenure(?:[\\s-]?track)?\\b",
    "\\b(?:position|appointment|applicants?|candidates?|ranked)\\b[^.]{0,160}\\bnon[\\s-]?tenure(?:[\\s-]?track)?\\b[^.]{0,100}\\b(?:or|and)\\b[^.]{0,100}\\btenure[\\s-]?track\\b",
    "\\bnon[\\s-]?tenure[\\s-]?earning\\b[^.]{0,80}\\bor\\b[^.]{0,80}\\btenure[\\s-]?earning\\b",
    "\\btenure[\\s-]?earning\\b[^.]{0,80}\\bor\\b[^.]{0,80}\\bnon[\\s-]?tenure[\\s-]?earning\\b",
  ].join("|"),
  "i"
);
const VARIABLE_TRACK_TITLE_RE =
  /\bopen\s+rank\s*\/\s*(?:open\s+)?(?:tenure|track)\b|\bopen\s+rank\s*\/\s*track\s+faculty\b|\btenure\s+or\s+career[\s-]?track\b|\bopen\s+rank\s+faculty\s*-\s*variable\s+track\b|\bopen\s+rank,?\s+tenure\s+or\s+clinical\s+professor\b|\bopen\s+rank\s+tenure\s+or\s+clinical\s+faculty\b|\bopen\s+track\s*:\s*.+\bprofessor\b.+\/\s*.+\bprofessor\s+of\s+professional\s+practice\b/i;
const VARIABLE_TRACK_STRUCTURED_RE =
  /\bis\s+this\s+position\s+tenure\s+track\s+or\s+non[\s-]?tenure\s+track\??\s*:?[\s\S]{0,60}\bdependent\s+on\s+selected\s+rank\b|\btenure\s+status\s*:?\s*open\s+tenure\b|\btenure\s*:\s*open\b/i;
const STANFORD_MULTI_LINE_RE =
  /\bStanford University\s+Non[\s-]?Tenure Line\b[\s\S]{0,180}\bUniversity Medical Line\b[\s\S]{0,180}\bUniversity Tenure Line\b/i;

export function classifyVariableAppointmentTrack(job = {}) {
  if (classifyTenureTrack(job) !== null) return false;
  if (matchesInstitutionVariablePolicy(job)) return true;
  const title = insertConcatenationBoundaries(String(job?.title || ""));
  const description = insertConcatenationBoundaries(String(job?.description || ""))
    .replace(AGGREGATE_FACULTY_COUNT_RE, " ")
    .replace(VISA_SPONSORSHIP_TRACK_BOILERPLATE_RE, " ");
  return (
    VARIABLE_TRACK_TITLE_RE.test(title) ||
    VARIABLE_TRACK_STRUCTURED_RE.test(description) ||
    STANFORD_MULTI_LINE_RE.test(description) ||
    VARIABLE_TRACK_RE.test(`${title} ${description}`)
  );
}

export function computeTenureTrackBreakdown(jobs = []) {
  let tenureTrack = 0;
  let nonTenureTrack = 0;
  let variableTrack = 0;
  let unknown = 0;

  for (const job of jobs) {
    const classification = classifyTenureTrack(job);
    if (classification === true) tenureTrack++;
    else if (classification === false) nonTenureTrack++;
    else if (classifyVariableAppointmentTrack(job)) variableTrack++;
    else unknown++;
  }

  const classified = tenureTrack + nonTenureTrack;
  return {
    tenureTrack,
    nonTenureTrack,
    variableTrack,
    unknown,
    classified,
    known: classified + variableTrack,
    tenureTrackPct: classified ? Number(((tenureTrack / classified) * 100).toFixed(1)) : 0,
    nonTenureTrackPct: classified ? Number(((nonTenureTrack / classified) * 100).toFixed(1)) : 0,
  };
}
