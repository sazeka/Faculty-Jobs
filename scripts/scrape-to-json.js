// scripts/scrape-to-json.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { scrapeAllJobsStandalone, callLocalSummarizer, getSystemGroup } from "../server.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

(async () => {
  const data = await scrapeAllJobsStandalone(); // { scrapedAt, count, jobs }

  // Local GPU LLM summarization (offline)
  if (data && Array.isArray(data.jobs)) {
    console.log(`📡 Calling local summarizer for ${data.jobs.length} jobs`);
    data.jobs = await callLocalSummarizer(data.jobs);
    for (const job of data.jobs) {
      job.systemGroup = getSystemGroup(job.source) || null;
    }
    data.count = data.jobs.length;
  }

  const targets = [
    path.join(__dirname, "..", "docs", "jobs.json"),
    path.join(__dirname, "..", "public", "jobs.json"),
  ];

  for (const outPath of targets) {
    fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
    console.log(`✅ Wrote ${outPath} (${data.count} jobs)`);
  }
})();
