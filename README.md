# Faculty Jobs Scraper

A Node.js + Playwright application that aggregates faculty job listings from:

- CUNY
- CT State Colleges & Universities
- California State University (CSU)
- University of Massachusetts (UMass)
- Selected Massachusetts private universities and liberal arts colleges

## Features
- Unified UI with filtering and search
- Automatic pagination ("More Jobs")
- Campus-level tagging for UMass
- Cached scraping to avoid hammering sites

## Tech Stack
- Node.js
- Express
- Playwright
- Vanilla JS (frontend)

## Run locally

```bash
npm install
npm run install:browsers
npm start
```

## Researcher Access

- Research guide: `docs/researchers.md`
- Data dictionary: `data/data-dictionary.md`
- JSON schema: `data/schema.json`
- Citation metadata: `CITATION.cff`
- Data usage/license notes: `LICENSE-DATA.md`

Create a dated dataset release from `public/jobs.json`:

```bash
npm run release:dataset
```

Optional custom date:

```bash
node scripts/release-dataset.js --date 2026-02-23
```
