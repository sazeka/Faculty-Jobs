#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const SOURCES = [
  ["public/jobs.json", "web-vue/public/jobs.json"],
  ["public/college-coords.json", "web-vue/public/college-coords.json"],
];

for (const [srcRel, dstRel] of SOURCES) {
  const src = path.join(ROOT, srcRel);
  const dst = path.join(ROOT, dstRel);
  if (!fs.existsSync(src)) {
    console.warn(`Skip missing source: ${srcRel}`);
    continue;
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  console.log(`Synced ${srcRel} -> ${dstRel}`);
}
