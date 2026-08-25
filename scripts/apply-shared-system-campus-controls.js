#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_PATH = path.join(ROOT, "server.js");
const OVERRIDES_PATH = path.join(ROOT, "data", "career-url-overrides.json");
const MASTER_PATH = path.join(ROOT, "data", "institutions-master.json");
const REPORT_PATH = path.join(ROOT, "generated", "shared-system-campus-control-milestone.json");

const UNH_TIME_TYPE = "1550a879b33f10037951f18fd1800000";
const UNH_FACULTY_TYPE = "b4f41dd8de101000c45c0d3fc2a10001";

const groups = [
  {
    source: "University of Connecticut",
    marker: '  {\n    campus: "University of Connecticut",',
    platformType: "pageup",
    items: [
      ["University of Connecticut-Avery Point", "UConn Avery Point"],
      ["University of Connecticut-Hartford Campus", "UConn Hartford"],
      ["University of Connecticut-Stamford", "UConn Stamford"],
      ["University of Connecticut-Waterbury Campus", "UConn Waterbury"],
    ].map(([name, control]) => ({
      name,
      controlType: "pageup_location",
      control,
      url: `https://careers.pageuppeople.com/967/cw/en-us/listing/?location=${encodeURIComponent(control)}`,
      config: `  { campus: ${JSON.stringify(name)}, type: "pageup-campus", url: ${JSON.stringify(`https://careers.pageuppeople.com/967/cw/en-us/listing/?location=${encodeURIComponent(control)}`)}, locationFilter: ${JSON.stringify(control)} },`,
    })),
  },
  {
    source: "University of New Hampshire System",
    marker: '  {\n    campus: "University of New Hampshire System",',
    platformType: "workday",
    items: [
      ["University of New Hampshire College of Professional Studies Online", "1ec6efc4979310011704df0483390000", "University of New Hampshire - College of Professional Studies"],
      ["University of New Hampshire-Franklin Pierce School of Law", "1ec6efc497931001170554505e2d0000", "University of New Hampshire - Franklin Pierce School of Law"],
      ["University of New Hampshire-Main Campus", "1ec6efc49793100117073793de1e0000", "University of New Hampshire – Main Campus"],
    ].map(([name, control, descriptor]) => {
      const url = `https://usnh.wd5.myworkdayjobs.com/Careers?locations=${control}&timeType=${UNH_TIME_TYPE}&workerSubType=${UNH_FACULTY_TYPE}`;
      return { name, controlType: "workday_location", control, descriptor, url, config: `  { campus: ${JSON.stringify(name)}, type: "workday", url: ${JSON.stringify(url)} },` };
    }),
  },
  {
    source: "Indiana University",
    marker: '  {\n    campus: "Indiana University",',
    platformType: "peopleadmin",
    items: [
      ["Indiana University-Bloomington", "236", "Bloomington"],
      ["Indiana University-Indianapolis", "532", "Indianapolis"],
      ["Indiana University-Kokomo", "513", "Kokomo"],
      ["Indiana University-South Bend", "475", "South Bend"],
      ["Indiana University-Southeast", "550", "Southeast"],
    ].map(([name, control, descriptor]) => {
      const url = `https://indiana.peopleadmin.com/postings/search?utf8=%E2%9C%93&query=&query_v0_posted_at_date=&query_organizational_tier_1_id%5B%5D=${control}&query_position_type_id%5B%5D=1&commit=Search`;
      return { name, controlType: "peopleadmin_campus", control, descriptor, url, config: `  { campus: ${JSON.stringify(name)}, type: "peopleadmin", url: ${JSON.stringify(url)} },` };
    }),
  },
  {
    source: "Rutgers, The State University of New Jersey",
    marker: '  {\n    campus: "Rutgers, The State University of New Jersey",',
    platformType: "peopleadmin",
    items: [
      ["Rutgers University-Newark", "1"],
      ["Rutgers University-Camden", "2"],
      ["Rutgers University-New Brunswick", "3"],
    ].map(([name, control]) => {
      const url = `https://jobs.rutgers.edu/postings/search?utf8=%E2%9C%93&query=&query_position_type_id%5B%5D=6&2182%5B%5D=3&2201%5B%5D=${control}&commit=Search`;
      return { name, controlType: "peopleadmin_campus", control, url, config: `  { campus: ${JSON.stringify(name)}, type: "rutgers", url: ${JSON.stringify(url)} },` };
    }),
  },
];

let server = fs.readFileSync(SERVER_PATH, "utf8");
const overrides = JSON.parse(fs.readFileSync(OVERRIDES_PATH, "utf8"));
const master = JSON.parse(fs.readFileSync(MASTER_PATH, "utf8"));
const existingOverrides = new Map((overrides.overrides || []).map((item) => [item.name.toLowerCase(), item]));
const institutions = new Map((master.institutions || []).map((item) => [item.name.toLowerCase(), item]));
const applied = [];
const now = new Date().toISOString();

for (const group of groups) {
  if (!server.includes(`campus: ${JSON.stringify(group.items[0].name)}`)) {
    const markerIndex = server.indexOf(group.marker);
    if (markerIndex < 0) throw new Error(`Could not find insertion marker for ${group.source}`);
    server = `${server.slice(0, markerIndex)}${group.items.map((item) => item.config).join("\n")}\n${server.slice(markerIndex)}`;
  }

  for (const item of group.items) {
    const notes = `Verified 2026-08-25 through the official public hiring board: exact ${item.controlType.replaceAll("_", " ")} control ${item.control}${item.descriptor ? ` (${item.descriptor})` : ""}. Campus route is ordered before the broad ${group.source} route so URL deduplication preserves exact campus attribution.`;
    const entry = {
      name: item.name,
      career_url: item.url,
      platform_type: group.platformType,
      coverage_source: group.source,
      notes,
    };
    const prior = existingOverrides.get(item.name.toLowerCase());
    if (prior) Object.assign(prior, entry);
    else {
      overrides.overrides.push(entry);
      existingOverrides.set(item.name.toLowerCase(), entry);
    }

    const institution = institutions.get(item.name.toLowerCase());
    if (!institution) throw new Error(`Institution missing from master: ${item.name}`);
    institution.career_url = item.url;
    institution.platform_type = group.platformType;
    institution.coverage_source = group.source;
    institution.coverage_status = "covered";
    institution.verification_status = "healthy";
    institution.last_verified_at = now;
    institution.last_discovery_status = "shared_system_exact_campus_control_validated";
    institution.last_discovery_confidence = 1;
    if (!String(institution.notes || "").includes(`control ${item.control}`)) {
      institution.notes = `${String(institution.notes || "").trim()} ${notes}`.trim();
    }
    applied.push({ ...item, source: group.source, platformType: group.platformType, config: undefined });
  }
}

overrides.updatedAt = now;
master.generatedAt = now;
master.counts.covered = master.institutions.filter((item) => item.coverage_status === "covered").length;
master.counts.missing = master.institutions.filter((item) => item.coverage_status === "missing").length;
fs.writeFileSync(SERVER_PATH, server);
fs.writeFileSync(OVERRIDES_PATH, `${JSON.stringify(overrides, null, 2)}\n`);
fs.writeFileSync(MASTER_PATH, `${JSON.stringify(master, null, 2)}\n`);
fs.writeFileSync(REPORT_PATH, `${JSON.stringify({
  generatedAt: now,
  appliedCount: applied.length,
  applied,
  heldForReview: [{
    name: "University of New Hampshire at Manchester",
    reason: "The official current Workday location facet exposes no Manchester campus control; keyword matches resolve to other UNH locations, so no unscoped fallback was promoted.",
  }],
}, null, 2)}\n`);

console.log(`Applied ${applied.length} exact shared-system campus controls.`);
