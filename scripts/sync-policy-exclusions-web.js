#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const SRC = path.join(ROOT, "generated", "policy-excluded-colleges.json");
const DESTS = [
  path.join(ROOT, "web-vue", "public", "policy-excluded-colleges.json"),
  path.join(ROOT, "public", "policy-excluded-colleges.json"),
  path.join(ROOT, "docs", "policy-excluded-colleges.json"),
];

if (!fs.existsSync(SRC)) {
  console.error(`Missing source file: ${SRC}`);
  console.error("Run: npm run build:policy-exclusions");
  process.exit(1);
}

for (const dest of DESTS) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(SRC, dest);
  console.log(`Synced ${path.relative(ROOT, SRC)} -> ${path.relative(ROOT, dest)}`);
}
