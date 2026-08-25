import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../../server.js", import.meta.url), "utf8");
const candidates = JSON.parse(
  fs.readFileSync(new URL("../../generated/promotion-candidates-four-year-next100.json", import.meta.url), "utf8")
);

test("validated four-year discoveries are active production sources", () => {
  assert.equal(candidates.count, 9);
  for (const item of candidates.items) {
    const escapedName = item.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const activeEntry = new RegExp(`^\\s*\\{ campus: "${escapedName}"`, "m");
    assert.match(source, activeEntry, item.name);
  }
});

test("new ATS types have state dispatcher support", () => {
  const ny = source.match(/async function scrapeNyPrivate[\s\S]*?async function scrapeSilcAccordionAs/);
  const oh = source.match(/async function scrapeOhAll[\s\S]*?async function scrapeNmAll/);
  assert.ok(ny);
  assert.ok(oh);
  assert.match(ny[0], /type === "adp"[\s\S]*scrapeAdpAs/);
  assert.match(ny[0], /type === "icims"[\s\S]*scrapeIcimsAs/);
  assert.match(oh[0], /type === "interviewexchange"[\s\S]*scrapeInterviewExchangeAs/);
});
