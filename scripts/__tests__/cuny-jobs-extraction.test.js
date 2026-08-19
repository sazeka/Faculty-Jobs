import assert from "node:assert/strict";
import test from "node:test";

import { extractCunyJobRows } from "../lib/cuny-jobs-extraction.js";

test("keeps only CUNY job-detail links and deduplicates them", () => {
  assert.deepEqual(
    extractCunyJobRows([
      {
        title: "  Assistant Professor - Biology  ",
        href: "/bronx-ny/assistant-professor/ABC123/job/",
        location: " Bronx, NY ",
      },
      { title: "Assistant Professor - Biology", href: "/bronx-ny/assistant-professor/ABC123/job/" },
      { title: "Faculty Affairs", href: "/job-category/faculty-affairs/jobs/" },
      { title: "Lehman College", href: "/campus/lehman-college/jobs/" },
      { title: "Non-Teaching Adjunct, Level 4 - Finance", href: "/new-york-ny/finance/DEF456/job/" },
    ]),
    [{
      title: "Assistant Professor - Biology",
      url: "https://cuny.jobs/bronx-ny/assistant-professor/ABC123/job/",
      location: "Bronx, NY",
      department: null,
    }]
  );
});

test("handles malformed CUNY anchor data", () => {
  assert.deepEqual(extractCunyJobRows(null), []);
  assert.deepEqual(extractCunyJobRows([{ title: "Professor", href: "not a url" }], "not a base"), []);
});
