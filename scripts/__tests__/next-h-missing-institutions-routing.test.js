import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const serverSource = fs.readFileSync(new URL("../../server.js", import.meta.url), "utf8");
const overrides = JSON.parse(
  fs.readFileSync(new URL("../../data/career-url-overrides.json", import.meta.url), "utf8")
).overrides;
const validation = JSON.parse(
  fs.readFileSync(new URL("../../generated/next-h-missing-institutions-validation.json", import.meta.url), "utf8")
);

test("four additional H institutions use exact official employee sources", () => {
  assert.match(serverSource, /Harris-Stowe State University", type: "adp"[\s\S]*?client=10376&ccId=19000101_000001/);
  assert.match(serverSource, /Haskell Indian Nations University", type: "generic"[\s\S]*?usajobs\.gov\/Search\/Results\?k=Haskell%20Indian%20Nations%20University/);
  assert.match(serverSource, /Hastings College", type: "adp"[\s\S]*?cid=47560b19-b691-4f4c-9de8-ff510ff2a256/);
  assert.match(serverSource, /Hood College", type: "ultipro-ukg"[\s\S]*?HOO1003HOODC\/JobBoard\/58a51caa-edd5-4489-a43e-478413a6c821/);

  for (const name of ["Harris-Stowe State University", "Haskell Indian Nations University", "Hastings College", "Hood College"]) {
    assert.ok(overrides.some((entry) => entry.name === name), `${name} override missing`);
  }
});

test("state dispatchers reach ADP and UKG production adapters", () => {
  const neDispatcher = serverSource.match(/async function scrapeNeAll[\s\S]*?async function scrapeIaAll/);
  const mdDispatcher = serverSource.match(/async function scrapeMdAll[\s\S]*?async function scrapeDcAll/);
  assert.ok(neDispatcher);
  assert.ok(mdDispatcher);
  assert.match(neDispatcher[0], /type === "adp"/);
  assert.match(mdDispatcher[0], /type === "ultipro-ukg"/);
  assert.match(serverSource, /searchParams\.get\("cid"\) \|\| u\.searchParams\.get\("client"\)/);
});

test("live validation records four newly covered institutions", () => {
  assert.equal(validation.newlyCoveredCount, 4);
  assert.equal(validation.projectedMissing, validation.baselineMissing - 4);
  assert.equal(validation.facultyJobCount, 7);
  assert.equal(validation.results.length, 4);
  for (const result of validation.results) assert.equal(result.healthySource, true);
  assert.equal(validation.results.filter((row) => row.facultyJobCount === 0).length, 2);
});
