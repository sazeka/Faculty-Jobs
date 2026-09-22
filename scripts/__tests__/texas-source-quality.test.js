import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../../server.js", import.meta.url), "utf8");

test("University of Houston excludes known staff roles from its academic feed", () => {
  assert.match(
    source,
    /University of Houston"[\s\S]{0,420}excludeTitleFilter: "\^\(\?:Program Manager/
  );
  assert.match(
    source,
    /Program Director 3 - College of Pharmacy/
  );
  assert.match(
    source,
    /if \(type === "nau-search"\) \{[\s\S]{0,520}excludeTitleFilter\s*\?\s*jobs\.filter/
  );
});
