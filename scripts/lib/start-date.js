// extractStartDate(text): pull an anticipated position START date out of a job
// description. This is a SOFT signal — faculty postings state it as free text and
// often as a season ("Fall 2026") or "negotiable" rather than a fixed day — so we
// only return a value when a start/begin phrase is clearly anchored to a date, and
// we label it "Anticipated start" in the UI. Distinct from datePosted (when the
// job was posted) and closeDate (application deadline).
//
// Returns one of:
//   - "YYYY-MM-DD"  when a full calendar date is given
//   - "Fall 2026" / "August 2026"  when only a season/month-year is given
//   - null  when nothing is confidently found

const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";
const MONTH_NUM = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7,
  aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const FULL = `(?:${MONTH}\\s+\\d{1,2},?\\s+\\d{4}|\\d{1,2}/\\d{1,2}/\\d{4}|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\s+${MONTH}\\s+\\d{4})`;
const SEASON = "(?:fall|spring|summer|winter|autumn)\\s+\\d{4}";
const MONTH_YEAR = `${MONTH}\\s+\\d{4}`;
// Order matters: full date first, then season, then bare month-year.
const VALUE = `(${FULL}|${SEASON}|${MONTH_YEAR})`;

// Each label must anchor on a START/BEGIN-of-appointment phrase so we don't grab
// "review begins", "application deadline", or "starting salary".
const LABELS = [
  `(?:anticipated|expected|projected|targeted?|tentative|preferred|desired|earliest)?\\s*(?:position |employment |appointment |faculty )?start(?:ing)?\\s+date\\b[\\s\\w]{0,14}?(?:is|of|:|will be|would be)?\\s*`,
  `(?:appointment|position|employment|the\\s+position)\\s+(?:is\\s+expected\\s+to\\s+|will\\s+|to\\s+)?(?:begin|start|commence)s?\\b[\\s\\w]{0,12}?(?:on|in|:)?\\s*`,
];

const RES = LABELS.map((l) => new RegExp(l + VALUE, "i"));

function pad(n) {
  return String(n).padStart(2, "0");
}

// Title-case a season/month-year string for display ("fall 2026" → "Fall 2026").
function titleSeason(s) {
  return s.replace(/\s+/g, " ").trim().replace(/^\w/, (c) => c.toUpperCase());
}

// Normalize a captured full-date string to YYYY-MM-DD, or null if implausible.
function toYmd(raw) {
  const s = raw.trim();
  let m;
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) {
    return `${m[3]}-${pad(m[1])}-${pad(m[2])}`;
  }
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) {
    return s;
  }
  // "Month DD, YYYY"
  if ((m = s.match(new RegExp(`^(${MONTH})\\s+(\\d{1,2}),?\\s+(\\d{4})$`, "i")))) {
    const mo = MONTH_NUM[m[1].toLowerCase().replace(/\.$/, "").slice(0, m[1].toLowerCase().startsWith("sept") ? 4 : 3)];
    if (mo) return `${m[3]}-${pad(mo)}-${pad(m[2])}`;
  }
  // "DD Month YYYY"
  if ((m = s.match(new RegExp(`^(\\d{1,2})\\s+(${MONTH})\\s+(\\d{4})$`, "i")))) {
    const mo = MONTH_NUM[m[2].toLowerCase().replace(/\.$/, "").slice(0, m[2].toLowerCase().startsWith("sept") ? 4 : 3)];
    if (mo) return `${m[3]}-${pad(mo)}-${pad(m[1])}`;
  }
  return null;
}

export function extractStartDate(text) {
  const t = String(text || "").replace(/\s+/g, " ");
  if (!t || t.length < 20) return null;
  for (const re of RES) {
    const m = re.exec(t);
    if (!m) continue;
    const val = m[1].trim();
    // Full date?
    const ymd = toYmd(val);
    if (ymd) {
      const y = Number(ymd.slice(0, 4));
      if (y >= 2023 && y <= 2100) return ymd;
      continue;
    }
    // Season or month-year — keep as a display string with a plausible year.
    const ym = val.match(/(\d{4})/);
    if (ym && Number(ym[1]) >= 2023 && Number(ym[1]) <= 2100) return titleSeason(val);
  }
  return null;
}
