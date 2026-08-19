# Faculty Atlas

**A scholarly directory of open faculty positions across North American higher education.**
Free to browse, no account required → **[www.facultyatlas.org](https://www.facultyatlas.org)**

Faculty Atlas aggregates **14,000+ open faculty listings** from **1,000+ institutions** across **50+ state systems and university networks**, normalizes them into a single searchable catalog, and refreshes automatically every other day.

---

## What it does

- **Scrapes** open faculty postings directly from institutional employment portals and applicant-tracking systems (Workday, PageUp, Taleo, PeopleAdmin, SchoolJobs, iCIMS, Interfolio, and more) using Playwright.
- **Normalizes & dedupes** listings into a unified schema, assigning stable canonical IDs.
- **Enriches** each posting with AI-extracted fields — discipline, tenure-track status, and position type — plus backfilled job descriptions.
- **Publishes** the catalog to a static Vue site on GitHub Pages, with client-side search, filtering, and a "new since last visit" indicator.
- **Self-maintains** via scheduled GitHub Actions: daily scrapes, data-health passes, dead-link pruning, institution discovery, and automatic frontend deploys.

## How it works

```
scrape (Playwright)  →  normalize + canonical IDs  →  AI enrich  →  quality gates
      →  public/jobs.json  →  chunked + synced to web-vue  →  Vue build  →  docs/ (GitHub Pages)
```

The scraper (`server.js` + `scripts/scrape-to-json.js`) writes `public/jobs.json`; the Vue app (`web-vue/`) renders it as chunked, lazy-loaded data. A set of resilience guards keep the dataset stable: per-source anti-flake healing (a flaky run can't wipe a state), confirmed-dead-URL pruning, and snapshot overwrite protection.

## Tech stack

- **Scraper / server:** Node.js, Express, Playwright
- **Frontend:** Vue 3 + Vite (static build)
- **AI enrichment:** Ollama (local dev) / Claude via the Anthropic API (CI)
- **Automation:** GitHub Actions
- **Hosting:** GitHub Pages (custom domain, HTTPS)
- **Analytics:** GoatCounter (privacy-first, no cookies)

## Automation (GitHub Actions)

| Workflow | Purpose |
|---|---|
| `scrape.yml` | Scrape sources, validate URLs, publish `jobs.json` (every other day) |
| `agent-team.yml` | Daily data-health pass: dead-listing removal, enrichment, description backfill, alerts |
| `institution-discovery.yml` | Weekly: seed from IPEDS, probe career pages, promote into the scrape config |
| `career-link-health.yml` | Verify institution career links |
| `data-hygiene.yml` | Periodic data-quality cleanup |
| `weekly-trends.yml` | Generate trend digests |
| `frontend-deploy.yml` | Rebuild & deploy the Vue bundle on frontend-source changes |

## Run locally

```bash
npm install
npm run install:browsers   # Playwright Chromium
npm start                  # serve the app

# Frontend dev (Vue):
npm run dev:frontend

# Run the test suite:
npm test
```

## Researcher access

- Research guide: `docs/researchers.md`
- Data dictionary: `data/data-dictionary.md`
- JSON schema: `data/schema.json`
- Citation metadata: `CITATION.cff`
- Data usage / license notes: `LICENSE-DATA.md`

Create a dated dataset release from `public/jobs.json`:

```bash
npm run release:dataset
# optional custom date:
node scripts/release-dataset.js --date 2026-02-23
```

Data-quality checks:

```bash
npm run verify:no-conflicts
npm run verify:career-links
npm run verify:critical-schools
```
