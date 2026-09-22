function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function exactListingKey(job = {}) {
  return [clean(job.college).toLowerCase(), clean(job.title).toLowerCase(), clean(job.url)].join("\u0000");
}

function richness(job = {}) {
  let score = clean(job.description).length;
  for (const field of ["department", "specialization", "discipline", "positionType", "location", "datePosted"]) {
    if (clean(job[field])) score += 500;
  }
  if (typeof job.tenureTrack === "boolean") score += 1_000;
  return score;
}

function mergeExactCopies(copies) {
  const ordered = [...copies].sort((a, b) => richness(b) - richness(a));
  const merged = { ...ordered[0] };

  for (const copy of ordered.slice(1)) {
    for (const [field, value] of Object.entries(copy)) {
      if ((merged[field] == null || merged[field] === "") && value != null && value !== "") {
        merged[field] = value;
      }
    }
  }

  const firstSeen = copies.map((job) => clean(job.firstSeen)).filter(Boolean).sort()[0];
  if (firstSeen) merged.firstSeen = firstSeen;
  return merged;
}

export function dedupeExactListings(jobs = []) {
  const groups = new Map();
  const order = [];

  for (const job of jobs) {
    const key = exactListingKey(job);
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key).push(job);
  }

  const duplicateGroups = [];
  const deduped = order.map((key) => {
    const copies = groups.get(key);
    if (copies.length > 1) {
      duplicateGroups.push({
        copies: copies.length,
        college: clean(copies[0].college),
        title: clean(copies[0].title),
        url: clean(copies[0].url),
      });
    }
    return mergeExactCopies(copies);
  });

  return {
    jobs: deduped,
    removed: jobs.length - deduped.length,
    duplicateGroups,
  };
}
