import assert from "node:assert/strict";
import test from "node:test";
import { canonicalInstitutionName, isInstitutionAlias } from "../lib/institution-aliases.js";

test("canonicalizes known IPEDS identity aliases", () => {
  assert.equal(canonicalInstitutionName("Columbia University"), "Columbia University in the City of New York");
  assert.equal(canonicalInstitutionName(" franklin AND marshall college "), "Franklin & Marshall College");
  assert.equal(canonicalInstitutionName("Hunter College"), "CUNY Hunter College");
});

test("leaves canonical and unknown names unchanged", () => {
  assert.equal(canonicalInstitutionName("CUNY Hunter College"), "CUNY Hunter College");
  assert.equal(canonicalInstitutionName("Pomona College"), "Pomona College");
  assert.equal(isInstitutionAlias("Pomona College"), false);
});
