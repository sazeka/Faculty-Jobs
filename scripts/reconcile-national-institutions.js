#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseCsv, key } from "./lib/ipeds.js";
import {
  classifyIpedsRow,
  nationalInstitutionFromIpeds,
} from "./lib/national-institution-reconciliation.js";

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), "..");
const MASTER_PATH = path.join(ROOT, "data", "institutions-master.json");
const IPEDS_PATH = path.join(ROOT, "data", "ipeds", "hd2024.csv");
const REPORT_PATH = path.join(ROOT, "generated", "national-institution-reconciliation.json");

const apply = process.argv.includes("--apply");
const now = new Date().toISOString();
const master = JSON.parse(fs.readFileSync(MASTER_PATH, "utf8"));
const institutions = Array.isArray(master.institutions) ? master.institutions : [];
const ipedsRows = parseCsv(fs.readFileSync(IPEDS_PATH, "utf8"));
if (apply) {
  for (const institution of institutions) {
    if (institution.national_reconciliation_status !== "missing_career_url") continue;
    institution.aliases = [];
    institution.coverage_source = null;
    institution.reconciliation_source = "IPEDS national reconciliation";
    if (!institution.career_url) institution.coverage_status = "missing";
  }
}

const byUnitid = new Map();
const byName = new Map();
for (const institution of institutions) {
  if (institution.unitid) byUnitid.set(Number(institution.unitid), institution);
  if (institution.name) byName.set(key(institution.name), institution);
  for (const alias of institution.aliases || []) {
    const aliasKey = key(alias);
    if (aliasKey && !byName.has(aliasKey)) byName.set(aliasKey, institution);
  }
}

const classificationCounts = {};
const accounted = [];
const missing = [];
const conflicts = [];
const appended = [];

for (const raw of ipedsRows) {
  const classification = classifyIpedsRow(raw);
  classificationCounts[classification.reason] = (classificationCounts[classification.reason] || 0) + 1;
  if (!classification.eligible) continue;

  const candidate = nationalInstitutionFromIpeds(raw, now);
  const unitidMatch = candidate.unitid ? byUnitid.get(candidate.unitid) : null;
  if (unitidMatch) {
    accounted.push({ unitid: candidate.unitid, name: candidate.name, master_name: unitidMatch.name, matched_by: "unitid" });
    continue;
  }

  const nameMatch = byName.get(key(candidate.name));
  if (nameMatch && nameMatch.unitid && Number(nameMatch.unitid) !== candidate.unitid) {
    const originalName = candidate.name;
    candidate.name = `${candidate.name} (${candidate.state})`;
    const resolvedNameMatch = byName.get(key(candidate.name));
    if (resolvedNameMatch && (!resolvedNameMatch.unitid || Number(resolvedNameMatch.unitid) === candidate.unitid)) {
      if (apply) {
        Object.assign(resolvedNameMatch, {
          unitid: candidate.unitid,
          state: candidate.state,
          sector: candidate.sector,
          level: candidate.level,
          control: candidate.control,
          is_degree_granting: candidate.is_degree_granting,
          metadata_source: "IPEDS",
        });
        if (!resolvedNameMatch.homepage_url) resolvedNameMatch.homepage_url = candidate.homepage_url;
      }
      accounted.push({
        unitid: candidate.unitid,
        name: originalName,
        master_name: resolvedNameMatch.name,
        matched_by: "state-qualified name",
      });
      continue;
    }
    candidate.notes = `${candidate.notes} Display name includes the state to distinguish an identically named institution with another UNITID.`;
    conflicts.push({
      unitid: candidate.unitid,
      name: originalName,
      master_unitid: nameMatch.unitid,
      master_name: nameMatch.name,
      resolved_name: candidate.name,
      reason: "name matches a different UNITID",
    });
    missing.push(candidate);
    if (apply) {
      institutions.push(candidate);
      appended.push(candidate);
      if (candidate.unitid) byUnitid.set(candidate.unitid, candidate);
      byName.set(key(candidate.name), candidate);
    }
    continue;
  }
  if (nameMatch) {
    if (apply) {
      Object.assign(nameMatch, {
        unitid: candidate.unitid,
        state: candidate.state,
        sector: candidate.sector,
        level: candidate.level,
        control: candidate.control,
        is_degree_granting: candidate.is_degree_granting,
        metadata_source: "IPEDS",
      });
      if (!nameMatch.homepage_url) nameMatch.homepage_url = candidate.homepage_url;
    }
    accounted.push({ unitid: candidate.unitid, name: candidate.name, master_name: nameMatch.name, matched_by: "name" });
    continue;
  }

  missing.push(candidate);
  if (apply) {
    institutions.push(candidate);
    appended.push(candidate);
    if (candidate.unitid) byUnitid.set(candidate.unitid, candidate);
    byName.set(key(candidate.name), candidate);
  }
}

if (apply) {
  const totalImported = institutions.filter(
    (row) => row.national_reconciliation_status === "missing_career_url"
  ).length;
  const totalNameConflictsResolved = institutions.filter(
    (row) =>
      row.national_reconciliation_status === "missing_career_url" &&
      / \([A-Z]{2}\)$/.test(String(row.name || ""))
  ).length;
  institutions.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  master.generatedAt = now;
  master.source = {
    ...(master.source || {}),
    nationalReconciliation: {
      reconciledAt: now,
      sourceFile: path.relative(ROOT, IPEDS_PATH),
      activeEligibleIpeds: accounted.length + missing.length,
      appended: appended.length,
      conflicts: conflicts.length,
      totalImported,
      totalNameConflictsResolved,
    },
  };
  master.institutions = institutions;
  master.counts = {
    totalInstitutions: institutions.length,
    covered: institutions.filter((row) => row.coverage_status === "covered").length,
    missing: institutions.filter((row) => row.coverage_status === "missing").length,
    quarantined: institutions.filter((row) => row.verification_status === "quarantined_broken_link").length,
  };
  fs.writeFileSync(MASTER_PATH, JSON.stringify(master, null, 2) + "\n", "utf8");
}

const report = {
  generatedAt: now,
  apply,
  inputs: {
    master: path.relative(ROOT, MASTER_PATH),
    ipeds: path.relative(ROOT, IPEDS_PATH),
  },
  definition: {
    geography: "50 states and District of Columbia",
    active: "IPEDS ACT=A and CYACTIVE=1",
    degreeGranting: "IPEDS DEGGRANT=1",
    levels: ["2-year", "4-year"],
    controls: ["public", "private nonprofit"],
  },
  counts: {
    ipedsRows: ipedsRows.length,
    activeEligibleIpeds: accounted.length + missing.length,
    alreadyAccounted: accounted.length,
    missingBeforeApply: missing.length,
    appended: appended.length,
    conflicts: conflicts.length,
    totalImported: institutions.filter(
      (row) => row.national_reconciliation_status === "missing_career_url"
    ).length,
    totalNameConflictsResolved:
      institutions.filter(
        (row) =>
          row.national_reconciliation_status === "missing_career_url" &&
          / \([A-Z]{2}\)$/.test(String(row.name || ""))
      ).length,
    masterAfterApply: institutions.length,
    classificationCounts,
  },
  conflicts,
  missingInstitutions: missing.map(({ notes, ...row }) => row),
};

fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(
  `${apply ? "Applied" : "Dry-run"} national reconciliation: eligible=${report.counts.activeEligibleIpeds}, accounted=${accounted.length}, missing=${missing.length}, appended=${appended.length}, conflicts=${conflicts.length}`
);
console.log(`Wrote ${path.relative(ROOT, REPORT_PATH)}`);
