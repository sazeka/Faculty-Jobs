import crypto from "node:crypto";
import { classifyTenureTrackWithEvidence, classifyVariableAppointmentTrack } from "./weekly-tenure-stats.js";

const MEDICAL_RE = /\b(?:medical|medicine|health|hospital|clinic(?:al)?|radiolog|surgery|surgeon|physician|nursing|pharmacy|dental|dentistry|patholog|pediatr|oncolog|cardiolog|anesthes|psychiatr|neurolog|obstetric|gynecolog)\w*\b/i;
const CONTROL_EVIDENCE = new Set([
  "title-explicit",
  "title-rank",
  "description-explicit",
  "description-structured-field",
  "description-direct-claim",
]);

function stableKey(job) {
  return String(job?.canonicalJobId || job?.url || `${job?.college || ""}\u0000${job?.title || ""}`);
}

function deterministicRows(rows, seed) {
  return [...rows].sort((left, right) => {
    const a = crypto.createHash("sha256").update(`${seed}\u0000${stableKey(left.job)}`).digest("hex");
    const b = crypto.createHash("sha256").update(`${seed}\u0000${stableKey(right.job)}`).digest("hex");
    return a.localeCompare(b);
  });
}

function isMedicalLike(job) {
  return MEDICAL_RE.test(`${job?.college || ""} ${job?.title || ""} ${job?.department || ""}`);
}

function compilePattern(value) {
  try {
    return value ? new RegExp(value, "i") : null;
  } catch {
    return null;
  }
}

function buildPolicyMatchers(institutionPolicy = {}, ipedsPolicy = {}) {
  const matchers = [];
  for (const policy of institutionPolicy.noTenureInstitutions || []) {
    if (!policy?.college) continue;
    matchers.push({
      kind: "no-tenure-institution",
      value: false,
      source: policy.source || null,
      note: policy.note || null,
      verifiedAt: policy.verifiedAt || null,
      matches: (job) => job?.college === policy.college,
    });
  }
  for (const [index, rule] of (institutionPolicy.rules || []).entries()) {
    const titleRe = compilePattern(rule?.titlePattern);
    const collegeRe = compilePattern(rule?.collegePattern);
    const descriptionRe = compilePattern(rule?.descriptionPattern);
    const urlRe = compilePattern(rule?.urlPattern);
    if (!titleRe || (!rule?.college && !collegeRe)) continue;
    matchers.push({
      kind: "institution-rule",
      index,
      value: rule.value,
      source: rule.source || null,
      note: rule.note || null,
      verifiedAt: rule.verifiedAt || null,
      matches: (job) =>
        (rule.college ? job?.college === rule.college : collegeRe.test(String(job?.college || ""))) &&
        titleRe.test(String(job?.title || "")) &&
        (!descriptionRe || descriptionRe.test(String(job?.description || ""))) &&
        (!urlRe || urlRe.test(String(job?.url || ""))),
    });
  }
  for (const [index, entry] of (ipedsPolicy.entries || []).entries()) {
    if (!entry?.college || !entry?.title || typeof entry.value !== "boolean") continue;
    matchers.push({
      kind: "ipeds-exact-rank",
      index,
      value: entry.value,
      source: ipedsPolicy.source || null,
      note: `IPEDS exact-rank evidence for UNITID ${entry.unitId || "unknown"}.`,
      verifiedAt: ipedsPolicy.verifiedAt || null,
      matches: (job) => job?.college === entry.college && job?.title === entry.title,
    });
  }
  return matchers;
}

function policyEvidence(job, matchers, expectedValue) {
  return matchers.find((matcher) => matcher.value === expectedValue && matcher.matches(job)) || null;
}

function take(rows, count, seed, used) {
  const selected = [];
  for (const row of deterministicRows(rows, seed)) {
    const key = stableKey(row.job);
    if (used.has(key)) continue;
    used.add(key);
    selected.push(row);
    if (selected.length === count) break;
  }
  return selected;
}

function sampleRow(row, stratum, index) {
  const classification = row.variable ? "variable" : row.classification.value === true ? "tenure-track" : row.classification.value === false ? "non-tenure-track" : "unclassified";
  return {
    sampleId: `AT-${String(index + 1).padStart(3, "0")}`,
    stratum,
    currentClassification: classification,
    evidence: row.classification.evidence || (row.variable ? "variable-language" : "none"),
    college: row.job.college || "",
    title: row.job.title || "",
    url: row.job.url || "",
    policySource: row.policy?.source || "",
    policyVerifiedAt: row.policy?.verifiedAt || "",
    medicalLike: isMedicalLike(row.job),
    manualLabel: "",
    manualEvidenceUrl: "",
    reviewer: "",
    reviewNotes: "",
  };
}

export function buildAppointmentTrackAudit({
  jobs = [],
  institutionPolicy = {},
  ipedsPolicy = {},
  seed = "2026-09-22",
  classify = classifyTenureTrackWithEvidence,
  classifyVariable = classifyVariableAppointmentTrack,
}) {
  const matchers = buildPolicyMatchers(institutionPolicy, ipedsPolicy);
  const rows = jobs.map((job) => {
    const classification = classify(job);
    const variable = classification.value === null && classifyVariable(job);
    const policy = classification.evidence === "institution-policy"
      ? policyEvidence(job, matchers, classification.value)
      : null;
    // Some persisted jobs retain the evidence label from the enrichment run
    // that populated their stored boolean. Do not count that historical label
    // as a live policy dependency when no current policy rule matches. Re-run
    // without the stored value to determine whether the posting itself still
    // independently supports the classification.
    const storedPolicyProvenance =
      classification.evidence === "institution-policy" && !policy && typeof job?.tenureTrack === "boolean";
    const fallbackClassification = storedPolicyProvenance
      ? classify({ ...job, tenureTrack: null, tenureEvidence: null })
      : null;
    return { job, classification, variable, policy, storedPolicyProvenance, fallbackClassification };
  });

  const evidenceCounts = {};
  for (const row of rows) {
    const key = row.classification.evidence || (row.variable ? "variable" : "unknown");
    evidenceCounts[key] = (evidenceCounts[key] || 0) + 1;
  }

  const policyRows = rows.filter((row) => row.classification.evidence === "institution-policy" && row.policy);
  const storedPolicyRows = rows.filter((row) => row.storedPolicyProvenance);
  const unknownRows = rows.filter((row) => row.classification.value === null && !row.variable);
  const variableRows = rows.filter((row) => row.variable);
  const medicalUnknownRows = unknownRows.filter((row) => isMedicalLike(row.job));
  const generalUnknownRows = unknownRows.filter((row) => !isMedicalLike(row.job));
  const controls = rows.filter((row) => CONTROL_EVIDENCE.has(row.classification.evidence));
  const used = new Set();
  const selected = [
    ...take(policyRows.filter((row) => row.classification.value === true), 40, `${seed}:policy:true`, used).map((row) => [row, "policy-tenure-track"]),
    ...take(policyRows.filter((row) => row.classification.value === false), 40, `${seed}:policy:false`, used).map((row) => [row, "policy-non-tenure-track"]),
    ...take(variableRows, 20, `${seed}:variable`, used).map((row) => [row, "variable-track"]),
    ...take(medicalUnknownRows, 40, `${seed}:unknown:medical`, used).map((row) => [row, "unclassified-medical"]),
    ...take(generalUnknownRows, 20, `${seed}:unknown:general`, used).map((row) => [row, "unclassified-general"]),
    ...take(controls.filter((row) => row.classification.value === true), 20, `${seed}:control:true`, used).map((row) => [row, "explicit-tenure-control"]),
    ...take(controls.filter((row) => row.classification.value === false), 20, `${seed}:control:false`, used).map((row) => [row, "explicit-non-tenure-control"]),
  ];
  const reviewSample = selected.map(([row, stratum], index) => sampleRow(row, stratum, index));

  const missingInstitutionSources = (institutionPolicy.noTenureInstitutions || []).filter((row) => !row?.source).length;
  const missingRuleSources = (institutionPolicy.rules || []).filter((row) => !row?.source).length;
  const invalidRules = (institutionPolicy.rules || []).filter((rule) => {
    if (!rule?.titlePattern || (!rule?.college && !rule?.collegePattern)) return true;
    return !compilePattern(rule.titlePattern) || (rule.collegePattern && !compilePattern(rule.collegePattern)) ||
      (rule.descriptionPattern && !compilePattern(rule.descriptionPattern)) || (rule.urlPattern && !compilePattern(rule.urlPattern));
  }).length;
  const storedCorrections = policyRows.filter((row) => typeof row.job.tenureTrack === "boolean" && row.job.tenureTrack !== row.classification.value).length;

  return {
    benchmark: "Faculty Atlas appointment-track precision audit",
    generatedAt: new Date().toISOString(),
    seed,
    methodology: {
      sample: "Deterministic 200-record stratified review sample: policy-dependent, variable, unresolved medical/general, and explicit-language controls.",
      interpretation: "Complete manualLabel and evidence fields before calculating precision. Unreviewed rows are not counted as validated.",
    },
    population: {
      jobs: rows.length,
      classified: rows.filter((row) => row.classification.value !== null).length,
      variable: variableRows.length,
      unclassified: unknownRows.length,
      unclassifiedMedicalLike: medicalUnknownRows.length,
      institutionPolicyClassified: policyRows.length,
      institutionPolicyInstitutions: new Set(policyRows.map((row) => row.job.college)).size,
      institutionPolicyTenureTrack: policyRows.filter((row) => row.classification.value === true).length,
      institutionPolicyNonTenureTrack: policyRows.filter((row) => row.classification.value === false).length,
    },
    evidenceCounts,
    safetyChecks: {
      invalidInstitutionRules: invalidRules,
      institutionPoliciesMissingSource: missingInstitutionSources,
      institutionRulesMissingSource: missingRuleSources,
      policyClassificationsWithoutResolvedSource: policyRows.filter((row) => !row.policy?.source).length,
      policyCorrectionsOfStoredBoolean: storedCorrections,
      storedPolicyProvenanceWithoutCurrentRule: storedPolicyRows.length,
      storedPolicyProvenanceWithoutIndependentSupport: storedPolicyRows.filter(
        (row) => row.fallbackClassification?.value !== row.classification.value
      ).length,
    },
    review: {
      requested: 200,
      generated: reviewSample.length,
      completed: reviewSample.filter((row) => row.manualLabel).length,
      status: "pending-independent-review",
    },
    reviewSample,
  };
}

function csvValue(value) {
  const text = value === true ? "true" : value === false ? "false" : String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function appointmentTrackAuditCsv(report) {
  const columns = [
    "sampleId", "stratum", "currentClassification", "evidence", "college", "title", "url",
    "policySource", "policyVerifiedAt", "medicalLike", "manualLabel", "manualEvidenceUrl", "reviewer", "reviewNotes",
  ];
  return `${columns.join(",")}\n${report.reviewSample.map((row) => columns.map((column) => csvValue(row[column])).join(",")).join("\n")}\n`;
}
