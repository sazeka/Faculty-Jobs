import { inferPlatformFromUrl } from "./url-normalization.js";

function hostnameFromUrl(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "invalid-url";
  }
}

function percentage(numerator, denominator) {
  return denominator ? Number(((numerator / denominator) * 100).toFixed(1)) : 0;
}

export function createDescriptionFetchReport() {
  const platforms = new Map();
  const hosts = new Map();

  function increment(map, key, base, outcome) {
    const row = map.get(key) || { ...base, attempted: 0, filled: 0, empty: 0, errors: 0 };
    row.attempted++;
    row[outcome]++;
    map.set(key, row);
  }

  return {
    record(url, outcome) {
      const normalizedOutcome = ["filled", "empty", "errors"].includes(outcome) ? outcome : "errors";
      const platform = inferPlatformFromUrl(url) || "unknown";
      const host = hostnameFromUrl(url);
      increment(platforms, platform, { platform }, normalizedOutcome);
      increment(hosts, `${platform}\t${host}`, { platform, host }, normalizedOutcome);
    },
    summarize() {
      const finish = (rows) => rows
        .map((row) => ({
          ...row,
          fillRatePct: percentage(row.filled, row.attempted),
          failureRatePct: percentage(row.empty + row.errors, row.attempted),
        }))
        .sort((a, b) => (b.empty + b.errors) - (a.empty + a.errors) || b.attempted - a.attempted);
      return {
        byPlatform: finish([...platforms.values()]),
        byHost: finish([...hosts.values()]),
      };
    },
  };
}
