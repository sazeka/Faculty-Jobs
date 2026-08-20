const CAMPUS_BY_KEY = {
  anchorage: "University of Alaska Anchorage",
  fairbanks: "University of Alaska Fairbanks",
  southeast: "University of Alaska Southeast",
};

export function inferAlaskaCampus(job) {
  if (String(job?.college || "").trim() !== "University of Alaska System") return null;

  // URL slugs and campus acronyms are stronger evidence than the current
  // location field, which older snapshots defaulted to Anchorage for every UA
  // posting. Preserve the system label when one posting names multiple campuses.
  const strong = `${job?.url || ""} ${job?.title || ""}`.toLowerCase();
  const matches = new Set();
  if (/\buaa\b|\b(anchorage|kodiak|palmer|wasilla|soldotna|homer)\b/.test(strong)) matches.add("anchorage");
  if (/\buaf\b|\b(fairbanks|bethel|dillingham|nome|kotzebue)\b/.test(strong)) matches.add("fairbanks");
  if (/\buas\b|\b(juneau|sitka|ketchikan)\b/.test(strong)) matches.add("southeast");
  if (matches.size === 1) return CAMPUS_BY_KEY[[...matches][0]];
  if (matches.size > 1) return null;

  const location = String(job?.location || "").toLowerCase();
  if (/\b(anchorage|kodiak|palmer|wasilla|soldotna|homer)\b/.test(location)) return CAMPUS_BY_KEY.anchorage;
  if (/\b(fairbanks|bethel|dillingham|nome|kotzebue)\b/.test(location)) return CAMPUS_BY_KEY.fairbanks;
  if (/\b(juneau|sitka|ketchikan)\b/.test(location)) return CAMPUS_BY_KEY.southeast;
  return null;
}

export function alaskaCampusLocation(campus) {
  if (campus === CAMPUS_BY_KEY.anchorage) return "Anchorage, AK";
  if (campus === CAMPUS_BY_KEY.fairbanks) return "Fairbanks, AK";
  if (campus === CAMPUS_BY_KEY.southeast) return "Juneau, AK";
  return null;
}
