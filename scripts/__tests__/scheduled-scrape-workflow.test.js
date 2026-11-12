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
  assert.match(heartbeat, /grep: "\^Scheduled scrape update",[\s\S]*?hours: 60,/);
  assert.match(heartbeat, /git log -1 --grep="\$\{hb\.grep\}"/);
  assert.doesNotMatch(heartbeat, /checkJetsonHeartbeat/);
});

// The Dell jobs went 2026-09-25 → 2026-11-07 failing silently; the heartbeat
// must keep watching both of their commit signatures.
test("heartbeat also watches the Dell's daily enrichment and weekly liveness commits", () => {
  for (const script of ["daily-enrichment.sh", "weekly-liveness-audit.sh"]) {
    assert.ok(fs.existsSync(new URL(`../${script}`, import.meta.url)), script);
  }
  const enrich = fs.readFileSync(new URL("../daily-enrichment.sh", import.meta.url), "utf8");
  const liveness = fs.readFileSync(new URL("../weekly-liveness-audit.sh", import.meta.url), "utf8");
  assert.match(enrich, /^Daily LLM enrichment \$STAMP:/m);
  assert.match(liveness, /^Weekly liveness audit \$STAMP:/m);
  assert.match(heartbeat, /grep: "\^Daily LLM enrichment",[\s\S]*?hours: 50,/);
  assert.match(heartbeat, /grep: "\^Weekly liveness audit",[\s\S]*?hours: 204,/);
});
