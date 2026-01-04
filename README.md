# Faculty Jobs Scraper

A Node.js + Playwright application that aggregates faculty job listings from:

- CUNY
- CT State Colleges & Universities
- California State University (CSU)
- University of Massachusetts (UMass)

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
