import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDefaultFilters } from "../../web-vue/src/config/appConfig.js";
import { useJobFilters } from "../../web-vue/src/composables/useJobFilters.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const appSource = fs.readFileSync(path.join(ROOT, "web-vue/src/App.vue"), "utf8");
const dataSource = fs.readFileSync(path.join(ROOT, "web-vue/src/composables/useJobsData.js"), "utf8");
const filtersSource = fs.readFileSync(path.join(ROOT, "web-vue/src/composables/useJobFilters.js"), "utf8");

test("search input is debounced before it updates the active query", () => {
  assert.match(appSource, /setTimeout\(\(\) => updateFilters\(\{ q: value \}\), 175\)/);
  assert.match(appSource, /:value="queryDraft"/);
  assert.doesNotMatch(appSource, /descriptionSearchTimer/);
});

test("search uses compact static indexes and never downloads every description chunk", () => {
  assert.match(dataSource, /data\/jobs-search-index\.json/);
  assert.match(dataSource, /queryFullTextSearchIndex/);
  assert.match(dataSource, /loadJobDescription/);
  assert.doesNotMatch(dataSource, /async function loadFullDescriptions/);
});

test("one evaluation supplies results and every dynamic facet", () => {
  assert.match(filtersSource, /const filterEvaluation = computed\(\(\) => evaluateFilters/);
  for (const facet of ["state", "positionType", "college", "department", "discipline", "city"]) {
    assert.match(filtersSource, new RegExp(`filterEvaluation\\.value\\.facets\\.${facet}`));
  }
});

test("compact and indexed description terms combine across an AND query", () => {
  const jobsRef = { value: [
    { title: "Assistant Professor", college: "Example University", state: "AZ", source: "AZ", canonicalGroupId: "grp_1", canonicalJobId: "job_1", url: "https://example.edu/1" },
    { title: "Lecturer in Biology", college: "Other College", state: "CA", source: "CA", canonicalGroupId: "grp_2", canonicalJobId: "job_2", url: "https://example.edu/2" },
  ] };
  const filtersRef = { value: { ...createDefaultFilters(), q: "assistant quantum" } };
  const searchTermMatchesRef = { value: { query: "assistant quantum", byTerm: new Map([["quantum", new Set(["grp_1"])]]) } };
  const controls = useJobFilters({ jobsRef, filtersRef, isSavedJob: () => false, searchTermMatchesRef });

  assert.deepEqual(controls.filteredJobs.value.map((job) => job.canonicalGroupId), ["grp_1"]);
  assert.equal(controls.stateOptions.value.find((option) => option.value === "AZ")?.count, 1);
  assert.equal(controls.stateOptions.value.find((option) => option.value === "CA")?.count, 0);
});
