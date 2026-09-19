// Post-enrichment consistency audit (issue #151): flags a stored `discipline`
// that flatly contradicts a high-confidence, single-subject title -- e.g.
// "Adjunct Biology Instructor" stored as discipline "Business". These are not
// reasonable broad-vs-specific taxonomy calls; the stored value names a
// completely unrelated field from the one the title (and usually the
// department) explicitly states.
//
// Deliberately conservative: this only fires when the title matches one of a
// small number of structural, labeled/separated single-subject patterns seen
// across the confirmed examples in issue #151 ("Adjunct Faculty: Chemistry",
// "Adjunct Faculty - Economics", "Postdoctoral Fellow in Quantum Physics",
// "Adjunct <Subject> Instructor", ...), not a bare substring search across the
// whole title -- that would false-positive constantly (e.g. "History" inside
// "Art History", "Art" inside "Department"). It only recognizes a curated
// vocabulary of unambiguous single-subject terms, so a genuinely
// interdisciplinary or compound title ("Accounting, Finance, and Economics")
// is never flagged as long as the stored discipline mentions at least one of
// the matched subjects.
import { normalizeDisciplineValue } from "./discipline-normalize.js";

// Canonical discipline label for each unambiguous single-subject term, keyed
// by the lowercase subject text. Values match the actual discipline strings
// already used elsewhere in this dataset (verified against public/jobs.json's
// live vocabulary), not the coarse top-level categories from
// web-vue/src/composables/useJobFilters.js's DISCIPLINE_RULES.
export const SINGLE_SUBJECT_DISCIPLINES = new Map([
  ["biology", "Biology"],
  ["chemistry", "Chemistry"],
  ["physics", "Physics"],
  ["quantum physics", "Physics"],
  ["economics", "Economics"],
  ["sociology", "Sociology"],
  ["psychology", "Psychology"],
  ["mathematics", "Mathematics"],
  ["nursing", "Nursing"],
  ["anthropology", "Anthropology"],
  ["philosophy", "Philosophy"],
  ["history", "History"],
  ["accounting", "Accounting"],
  ["finance", "Finance"],
  ["marketing", "Marketing"],
  ["spanish", "Spanish"],
  ["french", "French"],
  ["art history", "Art History"],
  ["art education", "Art Education"],
  ["computer science", "Computer Science"],
  ["social work", "Social Work"],
  ["political science", "Political Science"],
  ["criminal justice", "Criminal Justice"],
]);

// "Adjunct Faculty: Chemistry" / "Adjunct Faculty - Economics" /
// "Adjunct Faculty in Art Education/Art History" / "Postdoctoral Fellow in
// Quantum Physics" -- a role phrase, a labeled separator (colon/dash/"in"),
// then the subject.
const LABELED_SUBJECT_RE =
  /^(?:adjunct\s+faculty|adjunct\s+instructor|postdoctoral\s+fellow|faculty|lecturer)(?:\s*[-:–—]\s*|\s+in\s+)(.+)$/i;

// "Adjunct Biology Instructor" -- the subject sandwiched between the role
// modifier and the rank noun.
const SANDWICHED_SUBJECT_RE = /^adjunct\s+(.+?)\s+instructor$/i;

function extractTitleSubjects(title) {
  const t = String(title || "").trim();
  const subjects = [];
  const labeled = LABELED_SUBJECT_RE.exec(t);
  if (labeled) subjects.push(labeled[1]);
  const sandwiched = SANDWICHED_SUBJECT_RE.exec(t);
  if (sandwiched) subjects.push(sandwiched[1]);
  return subjects;
}

// A labeled subject can itself be a compound ("Art Education/Art History",
// "Accounting, Finance, and Economics") -- split it into individual
// candidate subjects rather than requiring the whole phrase to be an exact
// vocabulary match.
function candidateSubjects(subjectText) {
  return String(subjectText || "")
    .replace(/\([^)]*\)/g, " ") // drop parenthetical asides, e.g. "(Remote/Asynchronous)"
    .split(/\/|,|\band\b/i)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

// Returns null when the stored discipline is missing or is consistent with
// (mentions, or is mentioned by) at least one high-confidence subject the
// title names. Otherwise returns a descriptor identifying the contradiction,
// with one or more suggested corrections.
export function findDisciplineContradiction(job) {
  const storedDiscipline = normalizeDisciplineValue(job?.discipline);
  if (!storedDiscipline) return null;

  const rawSubjects = extractTitleSubjects(job?.title);
  if (rawSubjects.length === 0) return null;

  const suggestions = [];
  for (const raw of rawSubjects) {
    for (const candidate of candidateSubjects(raw)) {
      const canonical = SINGLE_SUBJECT_DISCIPLINES.get(candidate);
      if (canonical) suggestions.push(canonical);
    }
  }
  if (suggestions.length === 0) return null;

  const storedLower = storedDiscipline.toLowerCase();
  // Consistent if the stored value mentions (or is mentioned by) any matched
  // subject -- covers both an exact single-subject match and a genuinely
  // compound stored discipline that legitimately includes this subject.
  const isConsistent = suggestions.some((s) => {
    const sLower = s.toLowerCase();
    return storedLower === sLower || storedLower.includes(sLower) || sLower.includes(storedLower);
  });
  if (isConsistent) return null;

  return {
    title: job?.title || null,
    storedDiscipline,
    suggestedDisciplines: [...new Set(suggestions)],
  };
}

// Scans a full job list and returns every contradiction found, for reporting
// and for one-off correction scripts.
export function auditDisciplineConsistency(jobs = []) {
  const findings = [];
  for (const job of jobs) {
    const contradiction = findDisciplineContradiction(job);
    if (contradiction) findings.push({ ...contradiction, url: job?.url || null, college: job?.college || null });
  }
  return findings;
}
