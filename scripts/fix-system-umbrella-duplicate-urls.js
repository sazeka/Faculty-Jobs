#!/usr/bin/env node
// One-off migration for the historical duplicates behind issue #119:
// consolidateSystemUmbrellaDuplicates() (scripts/lib/duplicate-url-consolidation.js)
// is wired into scripts/scrape-to-json.js so every future scrape self-heals,
// but records already committed to public/jobs.json / docs/jobs.json from
// before that fix landed need a one-time pass to drop the existing
// system/umbrella-label duplicate copies (e.g. "University of Hawaii
// System" duplicating a "University of Hawaii-West Oahu" posting under the
// identical source URL).
//
// This intentionally reuses the exact same, narrowly-scoped logic as the
// scrape pipeline -- it does NOT touch genuine multi-campus postings like
// Crafton Hills College / San Bernardino Valley College (see
// scripts/lib/system-umbrella-institutions.js for why those are excluded).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { consolidateSystemUmbrellaDuplicates } from './lib/duplicate-url-consolidation.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DRY_RUN = process.argv.includes('--dry-run')
const TARGETS = ['public/jobs.json', 'docs/jobs.json']
const REPORT_PATH = path.join(ROOT, 'generated', 'system-umbrella-duplicate-urls-fix-report.json')

const source = JSON.parse(fs.readFileSync(path.join(ROOT, TARGETS[0]), 'utf8'))
const { jobs, dropped } = consolidateSystemUmbrellaDuplicates(source.jobs)

const report = {
  generatedAt: new Date().toISOString(),
  dryRun: DRY_RUN,
  before: source.jobs.length,
  after: jobs.length,
  droppedDuplicates: dropped.length,
  drops: dropped,
}
console.log(JSON.stringify({ ...report, drops: `${dropped.length} entries (see report file)` }, null, 2))

if (!DRY_RUN) {
  const output = { ...source, count: jobs.length, jobs }
  for (const relative of TARGETS) fs.writeFileSync(path.join(ROOT, relative), `${JSON.stringify(output, null, 2)}\n`)
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true })
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
}
