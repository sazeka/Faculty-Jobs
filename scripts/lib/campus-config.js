import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { clean, inferPlatformFromUrl, normalizeNameKey } from "./url-normalization.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "../..");
const SERVER_PATH = path.join(ROOT, "server.js");

export function parseCampusConfigs(serverText) {
  const rows = [];
  const lines = serverText.split(/\r?\n/);
  let cur = null;

  const flush = () => {
    if (cur && cur.campus && cur.url) {
      rows.push({
        name: clean(cur.campus),
        career_url: clean(cur.url),
        platform_type: clean(cur.type) || inferPlatformFromUrl(cur.url),
      });
    }
    cur = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const campusMatch = line.match(/campus:\s*"([^"]+)"/);
    const typeMatch = line.match(/type:\s*"([^"]+)"/);
    const urlMatch = line.match(/url:\s*"([^"]+)"/);

    if (line.startsWith("{") || /^const\s+[A-Z0-9_]+\s*=\s*\{$/.test(line)) {
      if (cur && (cur.campus || cur.url || cur.type)) flush();
      cur = {};
    }

    if (!cur) continue;
    if (campusMatch) cur.campus = campusMatch[1];
    if (typeMatch) cur.type = typeMatch[1];
    if (urlMatch) cur.url = urlMatch[1];

    // One-line campus objects end with "}," rather than starting with it.
    // Also flush at an array boundary so the final campus is not overwritten
    // by a following singleton config object before it can be recorded.
    if (line.endsWith("},") || line === "}" || line === "};" || line === "];" ) {
      flush();
    }
  }
  flush();

  const dedup = new Map();
  for (const r of rows) {
    const key = normalizeNameKey(r.name);
    if (!dedup.has(key)) dedup.set(key, r);
  }
  return [...dedup.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function loadCampusConfigs() {
  const serverText = fs.readFileSync(SERVER_PATH, "utf8");
  return parseCampusConfigs(serverText);
}
