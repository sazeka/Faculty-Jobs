import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(new URL("../../.github/workflows/scrape.yml", import.meta.url), "utf8");
const heartbeat = fs.readFileSync(new URL("../agent-alert-issues.js", import.meta.url), "utf8");

test("cloud scrape runs on an alternating-day schedule", () => {
  assert.match(workflow, /schedule:[\s\S]*?- cron: "17 3 \*\/2 \* \*"/);
});

test("scheduled and manual scrapes have distinct commit signatures", () => {
  assert.match(workflow, /github\.event_name.*schedule/);
  assert.match(workflow, /Scheduled scrape update/);
  assert.match(workflow, /Manual scrape update/);
});

test("heartbeat monitors the scheduled signature with alternating-day tolerance", () => {
  assert.match(heartbeat, /const HEARTBEAT_HOURS\s*=\s*60/);
  assert.match(heartbeat, /git log -1 --grep="\^Scheduled scrape update"/);
  assert.doesNotMatch(heartbeat, /checkJetsonHeartbeat/);
});
