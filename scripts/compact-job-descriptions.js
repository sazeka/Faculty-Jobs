#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compactJobDescriptions, DESCRIPTION_MAX_LENGTH } from './lib/description-backfill.js'
import { readJobsFile, writeJobsFile } from './lib/jobs-file.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const JOBS_PATH = path.join(ROOT, 'public/jobs.json')
const source = readJobsFile(JOBS_PATH)
const result = compactJobDescriptions(source)
writeJobsFile(JOBS_PATH, result.data)
console.log(`Truncated ${result.truncated} descriptions to ${DESCRIPTION_MAX_LENGTH} characters; removed ${result.charactersRemoved} characters.`)
