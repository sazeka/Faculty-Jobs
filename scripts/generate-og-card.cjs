// Renders the 1200x630 social share card to og-card.png using Playwright.
// Evergreen by design — no live counts baked in, so the image never goes stale
// (the og:description text carries the live numbers instead). Re-run only when
// the branding changes. Writes to web-vue/public/ and docs/ so it ships via both
// the build and direct Pages serving.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const OUTPUTS = [
  path.join(ROOT, 'web-vue', 'public', 'og-card.png'),
  path.join(ROOT, 'docs', 'og-card.png'),
];

// Brand palette from the favicon mark.
const CREAM = '#FFF8EF';
const INK = '#1D2A2B';
const TEAL = '#0F766E';
const ORANGE = '#C45C38';
const SLATE = '#355659';

const html = `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Newsreader:ital,opsz,wght@0,6..72,300..600;1,6..72,300..500&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1200px; height: 630px; }
  body {
    background: ${CREAM};
    font-family: 'Newsreader', serif;
    color: ${INK};
    position: relative;
    overflow: hidden;
  }
  /* warm vignette + thin frame */
  .frame { position: absolute; inset: 28px; border: 2px solid rgba(29,42,43,0.14); border-radius: 18px; }
  .wrap { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; padding: 92px 96px; }
  .mark { display: flex; align-items: center; gap: 22px; margin-bottom: 40px; }
  .badge { font-family: 'JetBrains Mono', monospace; font-size: 19px; letter-spacing: 0.34em; text-transform: uppercase; color: ${SLATE}; }
  h1 { font-family: 'Instrument Serif', serif; font-weight: 400; font-size: 132px; line-height: 0.94; letter-spacing: -1px; }
  .tag { font-family: 'Instrument Serif', serif; font-style: italic; font-size: 46px; line-height: 1.18; color: ${SLATE}; margin-top: 26px; max-width: 880px; }
  .accent { color: ${ORANGE}; }
  .foot { position: absolute; left: 96px; bottom: 84px; display: flex; align-items: center; gap: 18px; font-family: 'JetBrains Mono', monospace; font-size: 22px; color: ${INK}; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: ${ORANGE}; }
  /* decorative big mark on the right */
  .glyph { position: absolute; right: 78px; top: 50%; transform: translateY(-50%); opacity: 0.95; }
</style></head>
<body>
  <div class="frame"></div>
  <svg class="glyph" width="300" height="300" viewBox="0 0 64 64">
    <rect x="20" y="18" width="24" height="5" rx="2.5" fill="${INK}"/>
    <rect x="19" y="27" width="26" height="5" rx="2.5" fill="${SLATE}"/>
    <rect x="18" y="36" width="28" height="5" rx="2.5" fill="${TEAL}"/>
    <rect x="17" y="45" width="30" height="5" rx="2.5" fill="${ORANGE}"/>
    <path d="M32 12V52" stroke="${INK}" stroke-width="2.5" stroke-linecap="round" opacity="0.2"/>
    <circle cx="32" cy="12" r="5" fill="${ORANGE}"/>
  </svg>
  <div class="wrap">
    <div class="mark">
      <svg width="46" height="46" viewBox="0 0 64 64">
        <rect x="20" y="18" width="24" height="5" rx="2.5" fill="${INK}"/>
        <rect x="19" y="27" width="26" height="5" rx="2.5" fill="${SLATE}"/>
        <rect x="18" y="36" width="28" height="5" rx="2.5" fill="${TEAL}"/>
        <rect x="17" y="45" width="30" height="5" rx="2.5" fill="${ORANGE}"/>
        <circle cx="32" cy="12" r="5" fill="${ORANGE}"/>
      </svg>
      <span class="badge">The Atlas of Academic Hiring</span>
    </div>
    <h1>Faculty&nbsp;Atlas</h1>
    <div class="tag">Open faculty positions across North&nbsp;America, <span class="accent">charted.</span></div>
    <div class="foot"><span class="dot"></span> facultyatlas.org &nbsp;·&nbsp; free, no account required</div>
  </div>
</body></html>`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const buf = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 1200, height: 630 } });
  await browser.close();
  for (const out of OUTPUTS) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, buf);
    console.log(`wrote ${out} (${(buf.length / 1024).toFixed(0)} KB)`);
  }
})();
