import { clean } from "./url-normalization.js";

// Splits a notes blob into individual statements. Notes are built by
// concatenating whole sentences/statements with a single space (see
// appendUniqueInstitutionNote below), so splitting after sentence-ending
// punctuation followed by whitespace recovers those statement boundaries.
//
// This intentionally does NOT require the next character to be uppercase:
// plenty of real notes start a new statement with a lowercase URL/domain
// (e.g. "... Health Psychology). reed.edu/human_resources/employment
// redirects to ..."), and requiring uppercase let those repeated blocks slip
// through undetected as a single unsplittable ~26KB run-on "sentence"
// (Reed College). The tradeoff is occasionally over-splitting on an
// abbreviation period (e.g. "Official St. Olaf employment page ..." ->
// "Official St." + "Olaf employment page ..."), but that's harmless here:
// dedup only ever drops a fragment already seen earlier in the SAME
// institution's own notes, so a one-off abbreviation split still round-trips
// unchanged unless the exact same fragment pair repeats verbatim -- which is
// precisely the case we want to collapse.
const SENTENCE_SPLIT_RE = /(?<=[.!?])\s+/;

function splitSentences(text) {
  const cleaned = clean(text);
  if (!cleaned) return [];
  return cleaned
    .split(SENTENCE_SPLIT_RE)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function normalizeSentenceKey(sentence) {
  return sentence.replace(/\s+/g, " ").trim();
}

// Dedupes a list of sentences, preserving the first occurrence and relative
// order of each distinct statement.
function dedupeSentenceList(sentences) {
  const seen = new Set();
  const out = [];
  for (const sentence of sentences) {
    const key = normalizeSentenceKey(sentence);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(sentence);
  }
  return out;
}

// Collapses exact repeated sentences within a single notes blob, preserving
// the first occurrence/order of each distinct statement. This is the
// self-healing counterpart to appendUniqueInstitutionNote below: it can be
// run over notes text that already accumulated duplicates (e.g. before the
// per-append guard existed, or from an append site that doesn't use
// appendUniqueInstitutionNote) to clean it up without discarding any
// genuinely distinct content. Used by both the one-off migration for issue
// #161 and by build-institutions-master.js on every rebuild so any
// duplication introduced elsewhere in the pipeline gets self-healed instead
// of accumulating indefinitely.
export function dedupeNotesText(text) {
  const sentences = dedupeSentenceList(splitSentences(text));
  return clean(sentences.join(" ")) || null;
}

// Appends `addition` to `existing`, one sentence at a time, skipping any
// sentence from `addition` whose normalized form is already present in
// `existing`. Sentence-level (rather than whole-string) matching means this
// still dedupes correctly when `existing` has picked up other notes in
// between two calls with the same fixed override/quarantine text, and it
// also cleans up any duplication `existing` already contains.
export function appendUniqueInstitutionNote(existing, addition) {
  const existingSentences = dedupeSentenceList(splitSentences(existing));
  const additionSentences = splitSentences(addition);
  const seen = new Set(existingSentences.map(normalizeSentenceKey));
  const merged = [...existingSentences];
  for (const sentence of additionSentences) {
    const key = normalizeSentenceKey(sentence);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(sentence);
  }
  return clean(merged.join(" ")) || null;
}
