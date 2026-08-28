const TOKEN_PATTERN = /[a-z0-9]+(?:[+#.-][a-z0-9]+)*/g;

export function normalizeSearchText(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(?:nbsp|amp|quot|apos|lt|gt);/gi, " ")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9+#.\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenizeSearchText(value) {
  return normalizeSearchText(value).match(TOKEN_PATTERN)?.filter((token) => token.length >= 2 && token.length <= 64) || [];
}

function deltaEncode(values) {
  let previous = 0;
  const bytes = [];
  values.forEach((value, index) => {
    const delta = index === 0 ? value : value - previous;
    previous = value;
    let remaining = delta >>> 0;
    while (remaining >= 0x80) {
      bytes.push((remaining & 0x7f) | 0x80);
      remaining >>>= 7;
    }
    bytes.push(remaining);
  });
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function deltaDecode(encoded) {
  let bytes;
  if (typeof Buffer !== "undefined") bytes = Buffer.from(String(encoded || ""), "base64");
  else {
    const binary = atob(String(encoded || ""));
    bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }
  const decoded = [];
  let current = 0;
  let delta = 0;
  let shift = 0;
  for (const byte of bytes) {
    delta |= (byte & 0x7f) << shift;
    if (byte & 0x80) {
      shift += 7;
      continue;
    }
    current = decoded.length === 0 ? delta : current + delta;
    decoded.push(current);
    delta = 0;
    shift = 0;
  }
  return decoded;
}

export function buildFullTextSearchIndex(payload = {}, jobs = payload.jobs || []) {
  const rows = Array.isArray(jobs) ? jobs : [];
  const documentIds = [];
  const postings = new Map();

  rows.forEach((job, documentIndex) => {
    documentIds.push(String(job?.canonicalGroupId || job?.canonicalJobId || job?.url || `row-${documentIndex}`));
    const tokens = new Set(tokenizeSearchText([job?.description, job?.summary].filter(Boolean).join(" ")));
    for (const token of tokens) {
      if (!postings.has(token)) postings.set(token, []);
      postings.get(token).push(documentIndex);
    }
  });

  const terms = [...postings.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([term, documentIndexes]) => [term, deltaEncode(documentIndexes)]);

  return {
    version: 1,
    generatedAt: payload?.scrapedAt || null,
    documentIds,
    terms,
  };
}

function lowerBound(entries, term) {
  let low = 0;
  let high = entries.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (String(entries[mid]?.[0] || "") < term) low = mid + 1;
    else high = mid;
  }
  return low;
}

export function queryFullTextSearchIndex(index, queryTerms) {
  const entries = Array.isArray(index?.terms) ? index.terms : [];
  const documentIds = Array.isArray(index?.documentIds) ? index.documentIds : [];
  const matchesByTerm = new Map();

  for (const rawTerm of queryTerms || []) {
    const term = normalizeSearchText(rawTerm);
    if (term.length < 2) continue;
    const documentIndexes = new Set();
    let position = lowerBound(entries, term);

    while (position < entries.length) {
      const [token, deltas] = entries[position];
      // Two-character queries use an exact token to avoid expanding extremely
      // broad prefixes such as "in" across the complete vocabulary.
      const matches = term.length === 2 ? token === term : token.startsWith(term);
      if (!matches) break;
      for (const documentIndex of deltaDecode(deltas)) documentIndexes.add(documentIndex);
      position += 1;
    }

    matchesByTerm.set(term, new Set([...documentIndexes].map((documentIndex) => documentIds[documentIndex]).filter(Boolean)));
  }

  return matchesByTerm;
}
