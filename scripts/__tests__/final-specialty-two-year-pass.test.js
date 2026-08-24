import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../../server.js", import.meta.url), "utf8");

test("final specialty pass uses direct institution employee boards", () => {
  assert.match(source, /Hawaii Tokai International College.*type: "dayforce".*\/api\/HTIC\/V1\/JobFeeds/);
  assert.match(source, /Helms College.*type: "paycom".*CDA1B79B0620249447CBC9E755D51645/);
  assert.match(source, /Northern Maine Community College.*type: "paycom".*910231577C34180857BE4AB5F766DEF5/);
  assert.match(source, /Ultimate Medical Academy.*job-boards\.greenhouse\.io\/umaeducationinc/);
  assert.match(source, /Waubonsee Community College.*type: "csod".*careersite\/11/);
  assert.match(source, /York County Community College.*type: "paycom".*E6927E90DEBB918D88790AD51A36C462/);
});

test("campus-specific dispatchers support the newly introduced ATS types", () => {
  const gaDispatcher = source.match(/async function scrapeGaAll[\s\S]*?async function scrapeAlAll/);
  const hiDispatcher = source.match(/async function scrapeHiAll[\s\S]*?async function scrapeFloridaSouthernPortal/);
  assert.ok(gaDispatcher);
  assert.ok(hiDispatcher);
  assert.match(gaDispatcher[0], /type === "paycom"/);
  assert.match(hiDispatcher[0], /type === "dayforce"/);
});

test("shared systems remain strictly scoped after the final specialty pass", () => {
  assert.match(source, /Georgia State University-Perimeter College[\s\S]{0,260}query_organizational_tier_2_id%5B%5D=429/);
  assert.match(source, /Grossmont College[\s\S]{0,260}locations=ca95798f91ff0127dc8b3f75671b1cae/);
  assert.match(source, /San Bernardino Community College District[\s\S]{0,300}schooljobs\.com\/careers\/sbccd/);
});
