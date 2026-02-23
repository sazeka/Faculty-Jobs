# Researcher Access Guide

This project publishes faculty job snapshots for research and analysis.

## Data Access

- Current snapshot (JSON): `/public/jobs.json`
- Versioned release snapshots:
  - `/data/releases/YYYY-MM-DD.json`
  - `/data/releases/YYYY-MM-DD.csv`
  - `/data/releases/YYYY-MM-DD.metadata.json`
- Latest release aliases:
  - `/data/releases/latest.json`
  - `/data/releases/latest.csv`
  - `/data/releases/latest.metadata.json`
- Release index: `/data/releases/index.json`

## Data Structure

Primary payload (`jobs.json`) shape:

- `scrapedAt` (ISO timestamp)
- `count` (integer)
- `jobs` (array of job records)

Job record fields:

- `title`
- `url`
- `source`
- `category`
- `college`
- `location`
- `description`
- `department`
- `specialization`
- `systemGroup`

See:

- `data/data-dictionary.md`
- `data/schema.json`

## Coverage and Scope

Coverage depends on configured sources and policy exclusions in this repository:

- Institution universe: `data/institutions-master.json`
- Policy rules: `data/policy-rules.json`
- Effective exclusions: `generated/policy-excluded-colleges.json`
- Coverage report: `generated/coverage-report.json`

## Reproducibility

Typical pipeline:

```bash
npm install
npm run install:browsers
npm run scrape:json
npm run release:dataset
```

`release:dataset` converts the latest `public/jobs.json` into dated JSON/CSV snapshots.

## Caveats and Biases

- Data quality and completeness vary by source platform and anti-bot behavior.
- Job descriptions and metadata may be missing or null.
- This dataset reflects scraped public postings, not official HR system exports.
- Historical files are point-in-time snapshots and may not reflect later corrections.

## Citation and Licensing

- Citation metadata: `CITATION.cff`
- Data usage and licensing notes: `LICENSE-DATA.md`

