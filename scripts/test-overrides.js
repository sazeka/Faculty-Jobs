// One-off: test-scrape a set of campuses through scrapeGenericJobPage (which
// applies career-url-overrides) and report job counts, to verify newly-added
// overrides actually yield listings. Names passed as argv.
import { chromium } from "playwright";
import { scrapeGenericJobPage } from "../server.js";

const names = process.argv.slice(2);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121 Safari/537.36",
  viewport: { width: 1280, height: 800 },
  locale: "en-US",
});
for (const name of names) {
  try {
    const jobs = await scrapeGenericJobPage(context, "", name, name);
    const sample = (jobs || []).slice(0, 2).map((j) => j.title).join(" | ");
    console.log(`${(jobs?.length ?? 0).toString().padStart(3)}  ${name}${sample ? "  ::  " + sample : ""}`);
  } catch (e) {
    console.log(`ERR  ${name}  ${(e?.message || e).toString().slice(0, 80)}`);
  }
}
await browser.close();
