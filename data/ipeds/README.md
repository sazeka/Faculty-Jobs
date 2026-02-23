# IPEDS Import

This folder is for raw IPEDS institution files used to expand the national institution universe.

## Expected file

- Place the Institutional Characteristics / Header file CSV here (for example: `HD2024.csv`).
- Required columns supported by the importer: `UNITID`, `INSTNM`, `STABBR`, `SECTOR`, `CONTROL`, `ICLEVEL`.

## Import command

```bash
cd /Users/steveazeka/Documents/GitHub/Faculty-Jobs
npm run import:ipeds -- data/ipeds/HD2024.csv
```

Optional custom output path:

```bash
node scripts/import-ipeds-csv.js data/ipeds/HD2024.csv --out data/institutions-master.json
```

## What the importer does

- Merges IPEDS rows into `data/institutions-master.json` by `UNITID` first, then normalized institution name.
- Backfills: `unitid`, `state`, `sector`, `level`, `control`, `is_degree_granting`.
- Appends new institutions as `coverage_status: "missing"` with empty `career_url/platform_type` for later discovery.

## After import

Regenerate exclusions and coverage report:

```bash
npm run build:coverage
```

Then proceed with career-page discovery for `coverage_status: "missing"` institutions.

## Career-page auto discovery (step 3b)

Dry run:

```bash
npm run discover:careers
```

Apply updates to `data/institutions-master.json`:

```bash
npm run discover:careers:apply
```

Discovery report output:

- `generated/career-discovery-report.json`

Batch mode with checkpoints (recommended for long runs):

```bash
npm run discover:careers:batch
```

Batch checkpoints:

- `generated/career-discovery-checkpoints/batch-*.json`
- `generated/career-discovery-checkpoints/run-summary-*.json`

## Fallback seed from IPEDS WEBADDR

When search discovery returns no candidates, seed homepage URLs from IPEDS for the next unresolved group:

```bash
npm run seed:ipeds:webaddr
```

Outputs:

- Updates `data/institutions-master.json` for the first 25 unresolved eligible institutions
- Writes prep file: `generated/scrape-config-additions.json`
