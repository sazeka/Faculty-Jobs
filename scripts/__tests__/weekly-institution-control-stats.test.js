import test from "node:test";
import assert from "node:assert/strict";
import {
  buildInstitutionControlLookup,
  computeInstitutionControlBreakdown,
} from "../lib/weekly-institution-control-stats.js";

const institutions = [
  { name: "State University", aliases: ["State U"], control: "public" },
  { name: "Independent College", control: "private nonprofit" },
  { name: "Commercial College", control: "private for-profit" },
];

test("institution control lookup includes aliases without admitting for-profit controls", () => {
  const lookup = buildInstitutionControlLookup(institutions);
  assert.equal(lookup.get("state u"), "public");
  assert.equal(lookup.get("independent college"), "privateNonprofit");
  assert.equal(lookup.has("commercial college"), false);
});

test("institution control breakdown counts postings and keeps unmatched jobs unknown", () => {
  const jobs = [
    { college: "State University" },
    { college: "State U" },
    { college: "Independent College" },
    { college: "Commercial College" },
    { college: "Unmatched Institute" },
  ];

  assert.deepEqual(computeInstitutionControlBreakdown(jobs, institutions), {
    public: 2,
    privateNonprofit: 1,
    classified: 3,
    unknown: 2,
    publicPct: 66.7,
    privateNonprofitPct: 33.3,
  });
});
