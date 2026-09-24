import assert from "node:assert/strict";
import test from "node:test";
import { academicJobsOnlineSpecificTitle } from "../../server.js";

test("adds a specific AcademicJobsOnline field to otherwise generic professor titles", () => {
  assert.equal(
    academicJobsOnlineSpecificTitle("Assistant Professor", ["Economics", "F1 Trade"], "International Trade"),
    "Assistant Professor in International Trade"
  );
  assert.equal(
    academicJobsOnlineSpecificTitle("Associate/Full Professor", ["Economics / 00 Default:Any Field, L - Industrial Organization"], ""),
    "Associate or Full Professor in Industrial Organization"
  );
  assert.equal(
    academicJobsOnlineSpecificTitle("Assistant Professor of Biology", ["Ecology"], ""),
    "Assistant Professor of Biology"
  );
});
