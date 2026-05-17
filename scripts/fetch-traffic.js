#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import https from "https";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const REPO = "sazeka/Faculty-Jobs";
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      headers: {
        "User-Agent": "faculty-atlas-traffic-fetch",
        Accept: "application/vnd.github+json",
        ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
      },
    }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
        } else {
          resolve(JSON.parse(body));
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

async function main() {
  if (!TOKEN) {
    console.warn("No GH_TOKEN/GITHUB_TOKEN set — skipping traffic fetch.");
    process.exit(0);
  }

  const data = await get(`https://api.github.com/repos/${REPO}/traffic/views`);

  const traffic = {
    updatedAt: new Date().toISOString(),
    views14d: data.count,
    uniques14d: data.uniques,
  };

  const targets = [
    path.join(ROOT, "public", "traffic.json"),
    path.join(ROOT, "docs", "traffic.json"),
    path.join(ROOT, "web-vue", "public", "traffic.json"),
  ];

  for (const p of targets) {
    fs.writeFileSync(p, `${JSON.stringify(traffic, null, 2)}\n`, "utf8");
  }

  console.log(`Traffic: ${traffic.views14d} views, ${traffic.uniques14d} unique visitors (last 14 days)`);
}

main().catch((err) => {
  console.error("fetch-traffic failed:", err.message);
  process.exit(1);
});
