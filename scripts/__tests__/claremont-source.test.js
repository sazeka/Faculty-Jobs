import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("all Claremont campus scraper branches use the canonical source name", () => {
  const source = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
  const start = source.indexOf("async function scrapeClaremontAll");
  const end = source.indexOf("function toStaticJob", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const aggregator = source.slice(start, end);
  assert.doesNotMatch(aggregator, /campus,\s*["']Claremont["']/);
  assert.match(aggregator, /campus,\s*["']Claremont Colleges["']/);
});
