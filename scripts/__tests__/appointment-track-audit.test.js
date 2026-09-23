import test from "node:test";
import assert from "node:assert/strict";
import { appointmentTrackAuditCsv, buildAppointmentTrackAudit } from "../lib/appointment-track-audit.js";

function job(index, overrides = {}) {
  return {
    canonicalJobId: `job-${index}`,
    college: "Example University",
    title: `Role ${index}`,
    url: `https://example.edu/jobs/${index}`,
    description: "",
    ...overrides,
  };
}

test("buildAppointmentTrackAudit reports policy safety and produces reviewable rows", () => {
  const jobs = [
    job(1, { title: "Assistant Professor of History" }),
    job(2, { title: "Assistant Professor of Medicine" }),
    job(3, { title: "Tenure-Track Professor" }),
    job(4, { title: "Adjunct Professor" }),
  ];
  const institutionPolicy = {
    noTenureInstitutions: [],
    rules: [{
      college: "Example University",
      titlePattern: "^Assistant Professor of History$",
      value: true,
      source: "https://example.edu/policy",
      verifiedAt: "2026-09-22",
    }],
  };
  const classify = (row) => {
    if (row.title === "Assistant Professor of History") return { value: true, evidence: "institution-policy" };
    if (row.title === "Tenure-Track Professor") return { value: true, evidence: "title-explicit" };
    if (row.title === "Adjunct Professor") return { value: false, evidence: "title-rank" };
    return { value: null, evidence: null };
  };
  const report = buildAppointmentTrackAudit({
    jobs,
    institutionPolicy,
    ipedsPolicy: {},
    seed: "test",
    classify,
    classifyVariable: () => false,
  });

  assert.equal(report.population.jobs, 4);
  assert.equal(report.population.institutionPolicyClassified, 1);
  assert.equal(report.population.unclassifiedMedicalLike, 1);
  assert.equal(report.safetyChecks.invalidInstitutionRules, 0);
  assert.equal(report.safetyChecks.policyClassificationsWithoutResolvedSource, 0);
  assert.ok(report.reviewSample.some((row) => row.stratum === "policy-tenure-track"));
  assert.ok(report.reviewSample.some((row) => row.stratum === "unclassified-medical"));
  assert.match(appointmentTrackAuditCsv(report), /manualLabel,manualEvidenceUrl,reviewer,reviewNotes/);
});

test("buildAppointmentTrackAudit flags malformed and unsourced policy rules", () => {
  const report = buildAppointmentTrackAudit({
    jobs: [],
    institutionPolicy: { rules: [{ college: "X", titlePattern: "[", value: false }] },
    ipedsPolicy: {},
  });
  assert.equal(report.safetyChecks.invalidInstitutionRules, 1);
  assert.equal(report.safetyChecks.institutionRulesMissingSource, 1);
});

test("stored policy provenance is not mistaken for a live policy dependency", () => {
  const stored = job(5, {
    title: "Lecturer",
    tenureTrack: false,
    tenureEvidence: "institution-policy",
    description: "Job Type: Part-Time Temporary",
  });
  const report = buildAppointmentTrackAudit({
    jobs: [stored],
    institutionPolicy: {},
    ipedsPolicy: {},
    classify: (row) => row.tenureTrack === false
      ? { value: false, evidence: row.tenureEvidence || "stored" }
      : { value: false, evidence: "description-job-type" },
    classifyVariable: () => false,
  });

  assert.equal(report.population.institutionPolicyClassified, 0);
  assert.equal(report.safetyChecks.policyClassificationsWithoutResolvedSource, 0);
  assert.equal(report.safetyChecks.storedPolicyProvenanceWithoutCurrentRule, 1);
  assert.equal(report.safetyChecks.storedPolicyProvenanceWithoutIndependentSupport, 0);
});
