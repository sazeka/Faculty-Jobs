import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../../server.js", import.meta.url), "utf8");

test("Toledo excludes its non-academic group-fitness role from the faculty feed", () => {
  assert.match(
    source,
    /University of Toledo"[\s\S]{0,400}excludeTitleFilter: "\^Group Fitness Instructor\$"/
  );
  assert.match(
    source,
    /if \(type === "pageup"\) \{[\s\S]{0,260}excludeTitleFilter \? jobs\.filter/
  );
});
