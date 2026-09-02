#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeHomepageUrl, parseCsv } from "./lib/ipeds.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MASTER_PATH = path.join(ROOT, "data", "institutions-master.json");
const IPEDS_PATH = path.join(ROOT, "data", "ipeds", "hd2024.csv");

const MANUAL_HOMEPAGES = new Map([
  ["CUNY Advanced Science Research Center", "https://asrc.gc.cuny.edu/"],
  ["CUNY Language", "https://www.cuny.edu/academics/academic-programs/model-programs/cuny-college-transition-programs/cuny-language-immersion-program-clip/"],
  ["CUNY School of Professional Studies", "https://sps.cuny.edu/"],
  ["CUNY Start", "https://www1.cuny.edu/sites/cunystart/"],
  ["Los Angeles CCD", "https://www.laccd.edu/"],
  ["Los Angeles Trade-Tech College", "https://www.lattc.edu/"],
  ["Los Rios CCD", "https://losrios.edu/"],
  ["Minneapolis College", "https://minneapolis.edu/"],
  ["Minnesota State (2 Locations)", "https://www.minnstate.edu/"],
  ["Peralta CCD", "https://www.peralta.edu/"],
  ["San Diego College of Continuing Education", "https://www.sdcce.edu/"],
  ["SUNY Ncc", "https://ncc.edu/"],
]);

function hasHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function main() {
  const apply = process.argv.includes("--apply");
  const master = JSON.parse(fs.readFileSync(MASTER_PATH, "utf8"));
  const ipedsRows = parseCsv(fs.readFileSync(IPEDS_PATH, "utf8"));
  const ipedsByUnitid = new Map(
    ipedsRows.map((row) => [Number(row.UNITID), normalizeHomepageUrl(row.WEBADDR)])
  );

  const updated = [];
  const unresolved = [];
  for (const institution of master.institutions || []) {
    if (hasHttpUrl(institution.homepage_url) || hasHttpUrl(institution.career_url)) continue;

    const ipedsUrl = institution.unitid
      ? ipedsByUnitid.get(Number(institution.unitid))
      : null;
    const homepageUrl = ipedsUrl || MANUAL_HOMEPAGES.get(institution.name) || null;
    if (!homepageUrl) {
      unresolved.push(institution.name);
      continue;
    }

    institution.homepage_url = homepageUrl;
    updated.push({
      name: institution.name,
      homepage_url: homepageUrl,
      source: ipedsUrl ? "IPEDS HD2024 WEBADDR" : "manually verified official site",
    });
  }

  if (apply && unresolved.length === 0) {
    fs.writeFileSync(MASTER_PATH, `${JSON.stringify(master, null, 2)}\n`, "utf8");
  }

  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", updatedCount: updated.length, unresolved, updated }, null, 2));
  if (unresolved.length > 0) process.exitCode = 1;
}

main();
