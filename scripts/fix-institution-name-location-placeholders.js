#!/usr/bin/env node
// One-off migration for the historical placeholder locations behind issue
// #120: server.js's normalizeLocationByCollege() now resolves a location
// that's just the institution's own name plus a state suffix ("Wilson
// Community College, NC") to the real campus city/state, so every future
// scrape self-heals -- but records already committed to public/jobs.json /
// docs/jobs.json from before that fix landed need a one-time pass.
//
// This intentionally reuses the exact same building blocks as the live
// scrape pipeline (isPlaceholderLocation() from scripts/lib/post-quality.js,
// getCollegeLocationFallback() from server.js) via
// scripts/lib/institution-location-backfill.js, so it can never resolve a
// job differently than the scraper itself now would. Only exact
// institution-name matches are resolved (see server.js's
// getCollegeLocationFallback for why fuzzy/substring matching was removed in
// #127) -- an institution with no known campus city is left untouched.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { backfillPlaceholderLocations } from './lib/institution-location-backfill.js'
import { getCollegeLocationFallback } from '../server.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DRY_RUN = process.argv.includes('--dry-run')
const TARGETS = ['public/jobs.json', 'docs/jobs.json']
const REPORT_PATH = path.join(ROOT, 'generated', 'institution-name-location-placeholder-fix-report.json')

const source = JSON.parse(fs.readFileSync(path.join(ROOT, TARGETS[0]), 'utf8'))
const { jobs, changes } = backfillPlaceholderLocations(source.jobs, getCollegeLocationFallback)

const report = {
  generatedAt: new Date().toISOString(),
  dryRun: DRY_RUN,
  totalJobs: source.jobs.length,
  resolvedPlaceholders: changes.length,
  changes,
}
console.log(JSON.stringify({ ...report, changes: `${changes.length} entries (see report file)` }, null, 2))

if (!DRY_RUN) {
  const output = { ...source, jobs }
  for (const relative of TARGETS) fs.writeFileSync(path.join(ROOT, relative), `${JSON.stringify(output, null, 2)}\n`)
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true })
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
}
