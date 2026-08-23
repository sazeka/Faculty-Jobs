import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseCampusConfigs } from "../lib/campus-config.js";

test("parses one-line campus objects including the final array entry", () => {
  const source = `
const CAMPUSES = [
  { campus: "First College", type: "generic", url: "https://first.edu/jobs" },
  { campus: "Final College", type: "schooljobs", url: "https://schooljobs.com/final" },
];

const SYSTEM_MAIN = {
  campus: "System Main",
  url: "https://system.edu/jobs",
};
`;

  assert.deepEqual(parseCampusConfigs(source), [
    { name: "Final College", career_url: "https://schooljobs.com/final", platform_type: "schooljobs" },
    { name: "First College", career_url: "https://first.edu/jobs", platform_type: "generic" },
    { name: "System Main", career_url: "https://system.edu/jobs", platform_type: "generic" },
  ]);
});

test("Colorado campus dispatcher supports promoted CSOD sources", () => {
  const serverSource = fs.readFileSync(new URL("../../server.js", import.meta.url), "utf8");
  const coloradoDispatcher = serverSource.match(/async function scrapeCoAll\(context\)([\s\S]*?)\/\* ============================== OH/);
  assert.ok(coloradoDispatcher, "Colorado dispatcher exists");
  assert.match(coloradoDispatcher[1], /type === "csod"/);
  assert.match(coloradoDispatcher[1], /scrapeCsodAs\(context, url, campus, "CO"\)/);
});
