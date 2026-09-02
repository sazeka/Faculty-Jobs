import test from "node:test";
import assert from "node:assert/strict";

import { normalizeBjuFacultyTitle } from "../../server.js";

test("BJU faculty result cards keep only the actual position title", () => {
  assert.equal(
    normalizeBjuFacultyTitle(
      "Full-time, BJU, Inc. , Benefitted Biology Faculty POSITION SUMMARY: Invest in the future by providing instruction."
    ),
    "Biology Faculty"
  );
  assert.equal(
    normalizeBjuFacultyTitle(
      "Full-time, BJU, Inc. , Benefitted Dean of Health Professions POSITION SUMMARY: The dean will lead faculty."
    ),
    "Dean of Health Professions"
  );
});
