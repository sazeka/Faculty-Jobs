#!/usr/bin/env node
import { execSync } from "child_process";

function main() {
  let output = "";
  try {
    output = execSync('rg -n "^(<<<<<<<|=======|>>>>>>>)" --hidden --glob "!node_modules/**" --glob "!.git/**" .', {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    output = String(e?.stdout || "");
  }

  const lines = output.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length > 0) {
    console.error("Merge conflict markers detected:");
    for (const line of lines.slice(0, 200)) console.error(line);
    process.exit(1);
  }

  console.log("No merge conflict markers found.");
}

main();
