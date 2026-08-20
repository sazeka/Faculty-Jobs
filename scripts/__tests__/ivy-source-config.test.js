import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const serverPath = fileURLToPath(new URL("../../server.js", import.meta.url));

test("Dartmouth includes its dedicated Interfolio faculty board", () => {
  const source = fs.readFileSync(serverPath, "utf8");
  assert.match(
    source,
    /campus:\s*"Dartmouth College"[\s\S]{0,180}type:\s*"interfolio-inst"[\s\S]{0,180}apply\.interfolio\.com\/11002\/positions/
  );
});
