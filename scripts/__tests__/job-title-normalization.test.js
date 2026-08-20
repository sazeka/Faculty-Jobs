import assert from "node:assert/strict";
import test from "node:test";

import { normalizeJobTitle } from "../../server.js";

test("removes embedded and bracketed requisition codes without losing specialization", () => {
  assert.equal(
    normalizeJobTitle("Assistant to Associate Professor (Hematology/Oncology Fellowship Assoc. Program Director - 0088872T)"),
    "Assistant to Associate Professor (Hematology/Oncology Fellowship Assoc. Program Director)"
  );
  assert.equal(
    normalizeJobTitle("Assistant/Associate Professor (Hematology/Oncology Core - 88883T & 88886T)"),
    "Assistant/Associate Professor (Hematology/Oncology Core)"
  );
  assert.equal(
    normalizeJobTitle("Assistant Professor-in-Residence in Developmental Disabilities and Applied Behavior Analysis, College of Education [R0152682]."),
    "Assistant Professor-in-Residence in Developmental Disabilities and Applied Behavior Analysis, College of Education"
  );
});

test("expands a trailing MIS course code into its academic field", () => {
  assert.equal(
    normalizeJobTitle("Adjunct Faculty - MIS 630 ONL-Z"),
    "Adjunct Faculty - Information Systems"
  );
});
