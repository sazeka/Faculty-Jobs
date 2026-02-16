#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

const FILES = [
  path.join(process.cwd(), 'public', 'jobs.json'),
  path.join(process.cwd(), 'docs', 'jobs.json'),
];

const LOCATION_TO_CAMPUS = {
  'Bakersfield': 'California State University, Bakersfield',
  'Channel Islands': 'California State University Channel Islands',
  'Chico': 'California State University, Chico',
  'Dominguez Hills': 'California State University, Dominguez Hills',
  'East Bay': 'California State University, East Bay',
  'Fresno': 'California State University, Fresno',
  'Fullerton': 'California State University, Fullerton',
  'Humboldt': 'Cal Poly Humboldt',
  'Long Beach': 'California State University, Long Beach',
  'Los Angeles': 'California State University, Los Angeles',
  'Maritime Academy': 'California State University Maritime Academy',
  'Monterey Bay': 'California State University, Monterey Bay',
  'Northridge': 'California State University, Northridge',
  'Pomona': 'California State Polytechnic University, Pomona',
  'Sacramento': 'California State University, Sacramento',
  'San Bernardino': 'California State University, San Bernardino',
  'San Diego': 'San Diego State University',
  'San Francisco': 'San Francisco State University',
  'San Jose': 'San Jose State University',
  'San José': 'San Jose State University',
  'San Luis Obispo': 'California Polytechnic State University, San Luis Obispo',
  'San Marcos': 'California State University San Marcos',
  'Sonoma': 'Sonoma State University',
  'Stanislaus': 'California State University, Stanislaus',
};

const KNOWN_CAMPUSES = [
  'California State University Channel Islands',
  'California State University, Bakersfield',
  'California State University, Chico',
  'California State University, Dominguez Hills',
  'California State University, East Bay',
  'California State University, Fresno',
  'California State University, Fullerton',
  'California State University, Long Beach',
  'California State University, Los Angeles',
  'California State University Maritime Academy',
  'California State University, Monterey Bay',
  'California State University, Northridge',
  'California State University, Sacramento',
  'California State University, San Bernardino',
  'California State University San Marcos',
  'California State University, Stanislaus',
  'California State Polytechnic University, Pomona',
  'California Polytechnic State University, San Luis Obispo',
  'San Diego State University',
  'San Francisco State University',
  'San Jose State University',
  'Sonoma State University',
  'Cal Poly Humboldt',
  'Humboldt State University',
  'The California State University',
];

function decodeEntities(s) {
  return String(s || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTags(s) {
  return decodeEntities(String(s || '').replace(/<[^>]+>/g, ' '));
}

function pickLocation(html) {
  const patterns = [
    /<b>\s*Location:\s*<\/b>\s*<span[^>]*class="[^"]*location[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
    /<strong>\s*Location:\s*<\/strong>\s*([^<\n]+)/i,
    /"location"\s*:\s*"([^"]+)"/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) {
      const v = stripTags(m[1]).replace(/\s*\([^)]*\)\s*$/, '').trim();
      if (v) return v;
    }
  }
  return null;
}

function pickCampusFromText(html) {
  const text = stripTags(html);
  for (const name of KNOWN_CAMPUSES) {
    const re = new RegExp('\\b' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
    if (re.test(text)) {
      if (/^The California State University$/i.test(name)) return null;
      if (/^Humboldt State University$/i.test(name)) return 'Cal Poly Humboldt';
      return name;
    }
  }
  return null;
}

async function fetchHtml(url) {
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 FacultyJobs/CSU-Campus-Backfill',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      return await resp.text();
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 300 + Math.floor(Math.random() * 450)));
    }
  }
  throw lastErr || new Error('fetch failed');
}

async function enrichCsuJobs(jobs, concurrency = 3) {
  const csuIdx = [];
  for (let i = 0; i < jobs.length; i++) {
    const j = jobs[i];
    if (j && j.source === 'CSU' && j.url && (!j.college || !String(j.college).trim())) csuIdx.push(i);
  }

  let cursor = 0;
  let ok = 0;
  let failed = 0;

  async function worker() {
    while (cursor < csuIdx.length) {
      const idx = csuIdx[cursor++];
      const job = jobs[idx];
      try {
        await new Promise((r) => setTimeout(r, 180 + Math.floor(Math.random() * 320)));
        const html = await fetchHtml(job.url);
        const location = pickLocation(html);
        const byLocation = location ? LOCATION_TO_CAMPUS[location] || null : null;
        const byText = pickCampusFromText(html);
        const campus = byLocation || byText || null;

        if (campus) {
          job.college = campus;
          if (!job.location && location) job.location = location;
          ok++;
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return { total: csuIdx.length, ok, failed };
}

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function saveJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

async function run() {
  for (const file of FILES) {
    if (!fs.existsSync(file)) continue;
    const data = loadJson(file);
    if (!data || !Array.isArray(data.jobs)) continue;

    const before = data.jobs.filter((j) => j.source === 'CSU' && j.college).length;
    const stats = await enrichCsuJobs(data.jobs, 6);
    const after = data.jobs.filter((j) => j.source === 'CSU' && j.college).length;

    saveJson(file, data);
    console.log(`${path.relative(process.cwd(), file)}: CSU college filled ${before} -> ${after} (processed ${stats.total}, resolved ${stats.ok}, unresolved ${stats.failed})`);
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
