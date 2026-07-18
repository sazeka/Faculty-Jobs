#!/usr/bin/env node
/**
 * send-job-alerts.js
 *
 * Reads active subscribers from the job-alerts Cloudflare Worker (subscriber
 * state lives in Worker KV, never in this repo — see the plan doc for why),
 * applies each subscriber's saved filter using the exact same filtering logic
 * the Vue frontend uses (useJobFilters.js), and emails a digest of postings
 * that are new since the last time that subscriber was notified.
 *
 * "New" here means "not in lastNotifiedJobIds" (per-subscriber, tracked in
 * Worker KV) — not the frontend's isNew/"since last visit" flag, which is a
 * different, per-visitor-local concept.
 *
 * Usage:
 *   node scripts/send-job-alerts.js [--dry-run]
 *
 * Required env: JOB_ALERTS_WORKER_URL, ALERTS_INTERNAL_SECRET, RESEND_API_KEY
 * Optional env: FROM_EMAIL (defaults to alerts@alerts.facultyatlas.org)
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { useJobFilters } from "../web-vue/src/composables/useJobFilters.js";
import { createDefaultFilters } from "../web-vue/src/config/appConfig.js";
import { jobPath } from "./lib/job-slug.js";

// useJobFilters() only ever reads `.value` here (this script runs once, no
// need to react to changes), so a plain box is enough — no need to pull in
// 'vue' itself as a dependency of this root-level script (it's only resolvable
// from within web-vue/src, via web-vue's own node_modules).
function ref(value) {
  return { value };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BASE_URL = "https://www.facultyatlas.org";

const DRY_RUN = process.argv.includes("--dry-run");
const MAX_ITEMS_PER_EMAIL = 20;
const MAX_TRACKED_IDS = 500;
const RESEND_FREE_DAILY_CAP = 100;

const WORKER_URL = process.env.JOB_ALERTS_WORKER_URL;
const INTERNAL_SECRET = process.env.ALERTS_INTERNAL_SECRET;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || "alerts@alerts.facultyatlas.org";

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

async function fetchSubscribers() {
  const res = await fetch(`${WORKER_URL}/internal/subscribers`, {
    headers: { Authorization: `Bearer ${INTERNAL_SECRET}` },
  });
  if (!res.ok) throw new Error(`Failed to list subscribers (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return data.subscribers || [];
}

async function markSent(updates) {
  if (DRY_RUN || updates.length === 0) return;
  const res = await fetch(`${WORKER_URL}/internal/mark-sent`, {
    method: "POST",
    headers: { Authorization: `Bearer ${INTERNAL_SECRET}`, "Content-Type": "application/json" },
    body: JSON.stringify({ updates }),
  });
  if (!res.ok) throw new Error(`Failed to mark-sent (${res.status}): ${await res.text()}`);
}

async function sendDigestEmail({ email, unsubscribeToken, matches }) {
  const shown = matches.slice(0, MAX_ITEMS_PER_EMAIL);
  const remaining = matches.length - shown.length;
  const unsubscribeUrl = `${WORKER_URL}/unsubscribe?token=${unsubscribeToken}`;

  const items = shown
    .map((job) => {
      const url = `${BASE_URL}${jobPath(job)}`;
      const meta = [job.college, job.location].filter(Boolean).join(" · ");
      return `<li><a href="${esc(url)}">${esc(job.title)}</a><br><span style="color:#666;font-size:13px;">${esc(meta)}</span></li>`;
    })
    .join("\n");

  const html = `
    <p>${matches.length} new posting${matches.length === 1 ? "" : "s"} match your Faculty Atlas alert:</p>
    <ul>${items}</ul>
    ${remaining > 0 ? `<p>+ ${remaining} more — <a href="${BASE_URL}/">browse the full catalog</a>.</p>` : ""}
    <p style="color:#999;font-size:12px;"><a href="${esc(unsubscribeUrl)}">Unsubscribe from this alert</a></p>
  `;

  if (DRY_RUN) {
    console.log(`[dry-run] would email ${email}: ${matches.length} new match(es)`);
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: email,
      subject: `${matches.length} new faculty job${matches.length === 1 ? "" : "s"} matching your alert`,
      html,
    }),
  });
  if (!res.ok) throw new Error(`Resend send failed (${res.status}): ${await res.text()}`);
}

async function main() {
  if (!WORKER_URL || !INTERNAL_SECRET || (!DRY_RUN && !RESEND_API_KEY)) {
    console.error("Missing required env: JOB_ALERTS_WORKER_URL, ALERTS_INTERNAL_SECRET, RESEND_API_KEY");
    process.exit(1);
  }

  const payload = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "jobs.json"), "utf8"));
  const allJobs = payload.jobs || [];
  const jobsRef = ref(allJobs);

  const subscribers = await fetchSubscribers();
  console.log(`send-job-alerts: ${subscribers.length} active subscriber(s)${DRY_RUN ? " (dry run)" : ""}`);

  let sentCount = 0;
  const updates = [];

  for (const sub of subscribers) {
    const merged = { ...createDefaultFilters(), ...(sub.filters || {}) };
    const filtersRef = ref(merged);
    const { filteredJobs } = useJobFilters({ jobsRef, filtersRef, isSavedJob: () => false });

    const alreadyNotified = new Set(sub.lastNotifiedJobIds || []);
    const matches = filteredJobs.value;
    const newMatches = matches.filter((job) => !alreadyNotified.has(job.canonicalJobId));

    if (newMatches.length === 0) continue;

    if (!DRY_RUN && sentCount >= RESEND_FREE_DAILY_CAP) {
      console.warn(`send-job-alerts: hit Resend free-tier daily cap (${RESEND_FREE_DAILY_CAP}); skipping remaining subscribers this run`);
      break;
    }

    try {
      await sendDigestEmail({ email: sub.email, unsubscribeToken: sub.unsubscribeToken, matches: newMatches });
      sentCount++;
      const nextIds = [...new Set([...newMatches.map((j) => j.canonicalJobId), ...alreadyNotified])].slice(0, MAX_TRACKED_IDS);
      updates.push({ id: sub.id, lastNotifiedJobIds: nextIds });
    } catch (err) {
      console.error(`send-job-alerts: failed to email ${sub.email}: ${err.message}`);
    }
  }

  await markSent(updates);
  console.log(`send-job-alerts: ${sentCount} digest(s) ${DRY_RUN ? "would be sent" : "sent"}, ${updates.length} subscriber(s) ${DRY_RUN ? "would be" : ""} updated`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
