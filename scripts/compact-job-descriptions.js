#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compactJobDescriptions, DESCRIPTION_MAX_LENGTH } from './lib/description-backfill.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TARGETS = ['public/jobs.json', 'docs/jobs.json', 'web-vue/public/jobs.json']
const source = JSON.parse(fs.readFileSync(path.join(ROOT, TARGETS[0]), 'utf8'))
const result = compactJobDescriptions(source)
for (const relative of TARGETS) fs.writeFileSync(path.join(ROOT, relative), `${JSON.stringify(result.data, null, 2)}\n`)
console.log(`Truncated ${result.truncated} descriptions to ${DESCRIPTION_MAX_LENGTH} characters; removed ${result.charactersRemoved} characters.`)
