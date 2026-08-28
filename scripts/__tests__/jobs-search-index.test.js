import test from "node:test";
import assert from "node:assert/strict";
import { buildFullTextSearchIndex, normalizeSearchText, queryFullTextSearchIndex } from "../lib/jobs-search-index.js";

test("full-text index normalizes posting bodies and returns canonical groups", () => {
  const index = buildFullTextSearchIndex({ scrapedAt: "2026-08-28T00:00:00.000Z" }, [
    { canonicalGroupId: "grp_quantum", description: "<p>Quantum materials and café research.</p>" },
    { canonicalGroupId: "grp_biology", summary: "Teaching biology in the laboratory" },
    { canonicalGroupId: "grp_empty", description: "" },
  ]);

  assert.equal(index.documentIds.length, 3);
  assert.equal(index.generatedAt, "2026-08-28T00:00:00.000Z");
  assert.equal(normalizeSearchText("Café &amp; SCIENCE"), "cafe science");
  assert.deepEqual([...queryFullTextSearchIndex(index, ["quant"]).get("quant")], ["grp_quantum"]);
  assert.deepEqual([...queryFullTextSearchIndex(index, ["biolog"]).get("biolog")], ["grp_biology"]);
});

test("two-character description terms stay exact instead of expanding the vocabulary", () => {
  const index = buildFullTextSearchIndex({}, [
    { canonicalGroupId: "grp_exact", description: "Research in statistics" },
    { canonicalGroupId: "grp_prefix", description: "Instructor of statistics" },
  ]);
  assert.deepEqual([...queryFullTextSearchIndex(index, ["in"]).get("in")], ["grp_exact"]);
});
