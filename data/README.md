# Institutions + Policy Data

This folder defines the institution universe and policy exclusion logic used by the scraper.

## Files

- `institutions-master.json`: Canonical institution list (seeded from current scraper config + jobs snapshot).
- `policy-rules.json`: Platform-level and institution-level policy rules.

Generated output:

- `../generated/policy-excluded-colleges.json`: Effective exclusion list produced from `institutions-master.json` + `policy-rules.json`.
- `../generated/coverage-report.json`: Coverage summary for eligible universe (covered/missing/excluded/pending + by state/control/level).

## Update workflow

1. Update `institutions-master.json` (append missing institutions; fill `unitid`, `state`, `level`, `control`, etc.).
   Preferred: import IPEDS first.
   ```bash
   npm run import:ipeds -- data/ipeds/HD2024.csv
   ```
2. Update `policy-rules.json` (platform rules or institution overrides).
3. Regenerate exclusions:

```bash
npm run build:coverage
```

4. Discover missing career pages/platforms:

```bash
# Dry run report only
npm run discover:careers

# Apply discovered URLs/platforms into institutions-master.json
npm run discover:careers:apply

# Chunked apply with checkpoints and auto coverage rebuild
npm run discover:careers:batch
```

Policy checks:

```bash
# Rule/source integrity only (pre-scrape)
npm run verify:policy:pre

# Full integrity, including "no excluded colleges in jobs.json"
npm run verify:policy
```

## Notes

- `institutions-master.json` is currently a seed list. For full national coverage, merge in IPEDS institutions (UNITID-based).
- `server.js` reads `generated/policy-excluded-colleges.json` at startup and drops excluded institutions from scrape results.
