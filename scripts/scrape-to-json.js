// scripts/scrape-to-json.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { scrapeAllJobsStandalone } from "../server.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

(async () => {
  const data = await scrapeAllJobsStandalone(); // { scrapedAt, count, jobs }
  const outPath = path.join(__dirname, "..", "docs", "jobs.json");
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
  console.log(`✅ Wrote ${outPath} (${data.count} jobs)`);
})();
