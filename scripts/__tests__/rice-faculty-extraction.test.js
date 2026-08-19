import assert from "node:assert/strict";
import test from "node:test";

import { extractRiceFacultyRows } from "../lib/rice-faculty-extraction.js";

test("maps Rice's faculty feed to stable Interfolio job rows", () => {
  assert.deepEqual(
    extractRiceFacultyRows({
      results: [{
        legacy_position_id: 190536,
        name: "Assistant Teaching Professor",
        location: "Houston, Texas",
        unit_name: "Chemical and Biomolecular Engineering",
        open_date: "2026-08-03",
      }],
    }),
    [{
      title: "Assistant Teaching Professor",
      url: "https://apply.interfolio.com/190536",
      location: "Houston, Texas",
      department: "Chemical and Biomolecular Engineering",
      postedDate: "2026-08-03",
    }]
  );
});

test("drops malformed Rice feed entries", () => {
  assert.deepEqual(extractRiceFacultyRows({ results: [{ name: "No ID" }, null] }), []);
  assert.deepEqual(extractRiceFacultyRows(null), []);
});
