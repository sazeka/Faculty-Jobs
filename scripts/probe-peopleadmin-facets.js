#!/usr/bin/env node
const args = process.argv.slice(2);
const matchIndex = args.indexOf("--match");
const matchPattern = matchIndex >= 0 && args[matchIndex + 1]
  ? new RegExp(args[matchIndex + 1], "i")
  : null;
if (matchIndex >= 0) args.splice(matchIndex, 2);
const urls = args;
if (urls.length === 0) {
  console.error("Usage: node scripts/probe-peopleadmin-facets.js URL [URL ...]");
  process.exit(1);
}

for (const url of urls) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "Mozilla/5.0 FacultyJobsDiscovery/1.0" },
  });
  console.log(`\n${url}\t${response.status}\t${response.url}`);
  if (!response.ok) continue;
  const html = await response.text();
  const selectRe = /<select\b([^>]*)>([\s\S]*?)<\/select>/gi;
  let selectMatch;
  while ((selectMatch = selectRe.exec(html)) !== null) {
    const attrs = selectMatch[1];
    const name = attrs.match(/\bname=["']([^"']+)/i)?.[1]
      || attrs.match(/\bid=["']([^"']+)/i)?.[1]
      || "unnamed";
    const options = [];
    const optionRe = /<option\b([^>]*)>([\s\S]*?)<\/option>/gi;
    let optionMatch;
    while ((optionMatch = optionRe.exec(selectMatch[2])) !== null) {
      const value = optionMatch[1].match(/\bvalue=["']([^"']*)/i)?.[1] || "";
      const label = optionMatch[2].replace(/<[^>]+>/g, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
      if (value && label) options.push({ value, label });
    }
    const selected = matchPattern ? options.filter((option) => matchPattern.test(option.label)) : options;
    if (selected.length > 0) console.log(JSON.stringify({ name, options: selected }, null, 2));
  }
}
