# Faculty Atlas job-alerts Worker

Cloudflare Worker that captures job-alert signups and holds subscriber state in
KV. This exists because the site is a static, public GitHub Pages repo —
subscriber emails can't be committed there (see the repo's root plan doc for
why), so this is the one piece of infra that lives outside GitHub.

## One-time setup

```bash
cd workers/job-alerts
npm install
npx wrangler login

# Create the KV namespace, then paste the returned id into wrangler.toml
npx wrangler kv namespace create ALERTS_KV

# Set secrets (values shared with the GitHub repo's Action secrets — see below)
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put ALERTS_INTERNAL_SECRET
```

Also requires a [Resend](https://resend.com) account with a verified sending
domain (`FROM_EMAIL` in `wrangler.toml` must be an address on that *exact*
verified domain — we verified the subdomain `alerts.facultyatlas.org`, so
`FROM_EMAIL` is `alerts@alerts.facultyatlas.org`, not `alerts@facultyatlas.org`.
Resend rejects sends where the domain doesn't match a verified domain exactly).

## Deploy

```bash
npm run deploy
```

## GitHub Actions secrets

The `send-job-alerts` workflow needs to reach this Worker's `/internal/*`
routes. In the GitHub repo's settings, add:

- `RESEND_API_KEY` — same value as the Worker secret (used directly by the Action to send digest emails)
- `ALERTS_INTERNAL_SECRET` — same value as the Worker secret (authenticates the Action's calls to `/internal/subscribers` and `/internal/mark-sent`)
- `JOB_ALERTS_WORKER_URL` — this Worker's deployed URL (e.g. `https://faculty-atlas-job-alerts.<your-subdomain>.workers.dev`)

## Local dev

```bash
npm run dev
```

Then point the frontend's `VITE_ALERTS_WORKER_URL` env var at the printed
`http://localhost:8787` address.
