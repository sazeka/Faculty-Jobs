import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyIpedsRow,
  nationalInstitutionFromIpeds,
} from "../lib/national-institution-reconciliation.js";

const active = {
  UNITID: "123456",
  INSTNM: "Example University",
  STABBR: "TX",
  SECTOR: "1",
  CONTROL: "1",
  ICLEVEL: "1",
  DEGGRANT: "1",
  ACT: "A",
  CYACTIVE: "1",
  WEBADDR: "example.edu",
};

test("national reconciliation includes active eligible institutions", () => {
  assert.deepEqual(classifyIpedsRow(active), { eligible: true, reason: "active_eligible" });
  const institution = nationalInstitutionFromIpeds(active, "2026-01-01T00:00:00.000Z");
  assert.equal(institution.unitid, 123456);
  assert.equal(institution.homepage_url, "https://example.edu/");
  assert.equal(institution.career_url, null);
  assert.equal(institution.coverage_status, "missing");
});

test("national reconciliation excludes inactive, non-degree, and for-profit rows", () => {
  assert.equal(classifyIpedsRow({ ...active, ACT: "D" }).reason, "inactive_or_closed");
  assert.equal(classifyIpedsRow({ ...active, DEGGRANT: "2" }).reason, "not_degree_granting");
  assert.equal(classifyIpedsRow({ ...active, CONTROL: "3" }).reason, "control_out_of_scope");
});

