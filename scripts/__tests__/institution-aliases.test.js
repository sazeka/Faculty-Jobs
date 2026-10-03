import assert from "node:assert/strict";
import test from "node:test";
import { canonicalInstitutionName, isInstitutionAlias } from "../lib/institution-aliases.js";

test("canonicalizes known IPEDS identity aliases", () => {
  assert.equal(canonicalInstitutionName("Columbia University"), "Columbia University in the City of New York");
  assert.equal(canonicalInstitutionName(" franklin AND marshall college "), "Franklin & Marshall College");
  assert.equal(canonicalInstitutionName("Hunter College"), "CUNY Hunter College");
  assert.equal(canonicalInstitutionName("Tennessee Tech University"), "Tennessee Technological University");
  assert.equal(canonicalInstitutionName("University of California, Berkeley"), "UC Berkeley");
  assert.equal(canonicalInstitutionName("University of Wisconsin, Madison"), "UW-Madison");
  assert.equal(canonicalInstitutionName("University of California, San Diego"), "University of California-San Diego");
});

test("leaves canonical and unknown names unchanged", () => {
  assert.equal(canonicalInstitutionName("CUNY Hunter College"), "CUNY Hunter College");
  assert.equal(canonicalInstitutionName("Pomona College"), "Pomona College");
  assert.equal(isInstitutionAlias("Pomona College"), false);
});

test("canonicalizes 'St. Norbert College' to the IPEDS spelling (issue #119)", () => {
  assert.equal(canonicalInstitutionName("St. Norbert College"), "Saint Norbert College");
  assert.equal(isInstitutionAlias("St. Norbert College"), true);
  assert.equal(canonicalInstitutionName("Saint Norbert College"), "Saint Norbert College");
});

test("canonicalizes Trine's 'Regional/Non-Traditional Campuses' label (issue #119)", () => {
  assert.equal(canonicalInstitutionName("Trine University-Regional/Non-Traditional Campuses"), "Trine University");
  assert.equal(isInstitutionAlias("Trine University-Regional/Non-Traditional Campuses"), true);
  assert.equal(canonicalInstitutionName("Trine University"), "Trine University");
});

// The strict institution audit failed on these job-feed labels: one repeated
// St Cloud's UNITID, the rest had no state, control or level.
test("folds Minnesota State campus labels, single-college districts and St. Cloud into their institutions", () => {
  const expected = {
    "Central Lakes College": "Central Lakes College-Brainerd",
    "Minnesota State (Brainerd)": "Central Lakes College-Brainerd",
    "Minnesota State (Fergus Falls)": "Minnesota State Community and Technical College",
    "Minnesota State (Grand Rapids)": "Minnesota North College",
    "Minnesota State (Mnor Hibbing Campus)": "Minnesota North College",
    "Minnesota State (Ridg Willmar Campus)": "Ridgewater College",
    "Minnesota State (Roch Rochester Campus)": "Rochester Community and Technical College",
    "Minnesota State (Wins Winona Campus)": "Winona State University",
    "Citrus CCD": "Citrus College",
    "Gavilan CCD": "Gavilan College",
    "St. Cloud Technical and Community College": "St Cloud Technical and Community College",
  };
  for (const [alias, canonical] of Object.entries(expected)) {
    assert.equal(canonicalInstitutionName(alias), canonical, alias);
  }
});

test("alias targets are canonical names, not other aliases", () => {
  for (const name of ["Central Lakes College-Brainerd", "Minnesota North College", "St Cloud Technical and Community College", "Citrus College"]) {
    assert.equal(isInstitutionAlias(name), false, name);
  }
});
