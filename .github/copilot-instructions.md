## Quick orientation for AI coding agents

This repository is a small Node.js + Playwright scraper with a static frontend. The goal is to collect US faculty job postings, write them to JSON, and serve a lightweight UI. Below are the concrete, discoverable facts an agent should know to be productive.

### Big picture
- Scraper + API: `server.js` contains the scraper logic (Playwright) and exports `scrapeAllJobsStandalone()` for CI/GitHub Actions. When run directly (`node server.js`) it will start an Express server for local testing.
- CLI script: `scripts/scrape-to-json.js` calls `scrapeAllJobsStandalone()` and writes the output to `docs/jobs.json`.
- Static UI: `public/` and `docs/` contain near-identical static frontends (`index.html`) that read a jobs JSON file (`public/jobs.json` / `docs/jobs.json`) and render the results.

### Important files to reference
- `server.js` — main scraper, site lists, concurrency constants (e.g. `MAX_PARALLEL_CAMPUSES`, `MAX_PARALLEL_SYSTEMS`), and exports used by scripts.
- `scripts/scrape-to-json.js` — small runner that writes `docs/jobs.json`.
- `public/index.html` and `docs/index.html` — frontend UI (vanilla JS + static styling) that expects the JSON data produced by the scraper.
- `public/jobs.json` / `docs/jobs.json` — current scraped data; large JSON file containing { scrapedAt, count, jobs }.
- `package.json` — lists scripts you can run: `npm run install:browsers`, `npm run scrape:json`, and `npm start`.

### How to run / reproduce locally (explicit)
- Install deps: `npm install`
- Install Playwright browsers: `npm run install:browsers` (calls `playwright install chromium`)
- Run a full scrape and write `docs/jobs.json`: `npm run scrape:json`
- Start the local server/UI: `npm start` (runs `node server.js`) — set `PORT` to override the port.

### Deployment/data flow notes
- The scraper writes to `docs/jobs.json` (see `scripts/scrape-to-json.js`). The static UI consumes the JSON file under `public/` or `docs/` when served.
- The scraper config (which sites/campuses to query) is encoded as arrays/objects in `server.js` (e.g. `UMASS_CAMPUSES`, `UC_CAMPUSES`, etc.). To add a new source, add an entry to the appropriate array with a `campus`, `url`, and optionally a `type` key.

### Project-specific conventions and useful patterns
- ESM modules: `package.json` sets `"type": "module"`; files use `import`/`export` rather than CommonJS.
- Single-file scraper: most scrape logic and site lists live in `server.js`. Use that file as the canonical place to modify scraping behavior.
- Concurrency via env vars: tune `MAX_PARALLEL_CAMPUSES` and `MAX_PARALLEL_SYSTEMS` (set as environment variables) to reduce load or speed up runs.
- Safe logging: `logScrapeResult` helper is used for robust console output; prefer not to change logging format without checking callers.

### Quick debugging tips for agents
- If Playwright fails: ensure `npm run install:browsers` completed and that the environment allows headless Chromium.
- To run a single scrape in isolation, use `node server.js` (server starts and exposes endpoints) or `npm run scrape:json` to produce `docs/jobs.json` without starting Express.
- To inspect data used by the UI, open `public/jobs.json` (or `docs/jobs.json`) — it contains `jobs` array with objects like { title, url, source, category, college, location, description }.

### Example patterns to reference in patches
- Add a new campus: edit `server.js` and append an object to one of the CAMPUSES arrays (example in `UMASS_CAMPUSES`):
  - { campus: "UMass Example", url: "https://example.edu/en-us/filter/?..." }
- Change concurrency: set `MAX_PARALLEL_CAMPUSES=2` and `MAX_PARALLEL_SYSTEMS=1` when running locally to reduce parallel browser instances.

### What not to change without verification
- Avoid large structural refactors that split scraper logic out of `server.js` unless you run `npm run scrape:json` and confirm the produced `docs/jobs.json` shape remains identical.
- Don't assume an external API exists — scraping targets are site-specific and live in `server.js`.

If anything above is unclear or you want examples expanded (more code references or a suggested PR layout for migrating scraper logic), tell me which parts to expand and I will iterate.
