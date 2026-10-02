#!/usr/bin/env node
// Package a dated research release (from `npm run release:dataset`) for
// deposit in a Dataverse repository such as Harvard Dataverse.
//
//   node scripts/package-dataverse.js --date 2026-10-01
//
// Writes generated/dataverse/<date>/:
//   files/          everything to upload (data, README, codebook, schema, checksums)
//   dataset.json    Dataverse native-API payload for creating the dataset
//   dataset-version.json  the same metadata, for updating an existing draft
//   upload.sh       fills a DRAFT dataset (existing or new) with metadata and
//                   files/; never publishes
//
// Deposit settings (authors, contact, license, and either an existing draft's
// datasetPid or a collection to create one in) live in
// data/dataverse-deposit.json. Private values such as the contact email go in
// the git-ignored data/dataverse-deposit.local.json, merged over it. Unfilled required fields are reported here and
// block upload.sh, so placeholder metadata cannot reach a minted DOI.
import fs from "fs";
import path from "path";
import crypto from "node:crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i += 1;
  }
  return out;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function formatInt(n) {
  return Number(n).toLocaleString("en-US");
}

// Merge the git-ignored local overrides into the committed settings. Objects
// merge one level deep, so { "contact": { "email": ... } } keeps contact.name.
function readDepositConfig(configPath) {
  const deposit = readJson(configPath);
  const localPath = configPath.replace(/\.json$/, ".local.json");
  if (!fs.existsSync(localPath)) return deposit;
  for (const [key, value] of Object.entries(readJson(localPath))) {
    const isObject = value && typeof value === "object" && !Array.isArray(value);
    deposit[key] = isObject ? { ...deposit[key], ...value } : value;
  }
  return deposit;
}

function missingDepositFields(deposit) {
  const missing = [];
  if (!deposit.datasetPid && !deposit.collection) missing.push("datasetPid (or collection)");
  if (!deposit.contact?.email) missing.push("contact.email");
  deposit.authors.forEach((author, i) => {
    if (!author.name) missing.push(`authors[${i}].name`);
    if (!author.affiliation) missing.push(`authors[${i}].affiliation`);
  });
  return missing;
}

function summarize(jobs) {
  const firstSeen = jobs.map((j) => j.firstSeen).filter(Boolean).sort();
  const filled = (field) => jobs.filter((j) => j[field] !== null && j[field] !== "").length;
  return {
    count: jobs.length,
    institutions: new Set(jobs.map((j) => j.college).filter(Boolean)).size,
    unitidShare: jobs.length ? jobs.filter((j) => j.unitid !== null && j.unitid !== undefined).length / jobs.length : 0,
    states: new Set(jobs.map((j) => j.state).filter(Boolean)).size,
    firstSeenMin: firstSeen[0] || null,
    // Share of records whose firstSeen is the earliest value: a large share
    // means that date marks a tracking (re)start, not real first appearances.
    firstSeenAtMin: firstSeen.length ? firstSeen.filter((d) => d === firstSeen[0]).length / jobs.length : 0,
    completeness: Object.fromEntries(
      Object.keys(jobs[0] || {}).map((field) => [field, jobs.length ? filled(field) / jobs.length : 0]),
    ),
  };
}

function citationField(typeName, value, { multiple = false, typeClass = "primitive" } = {}) {
  return { typeName, multiple, typeClass, value };
}

function compound(fields) {
  return Object.fromEntries(
    fields
      .filter(([, value]) => value)
      .map(([typeName, value]) => [typeName, citationField(typeName, value)]),
  );
}

function buildDatasetJson({ deposit, manifest, stats, description }) {
  const collectionDate = (manifest.scrapedAt || manifest.date).slice(0, 10);
  const authors = deposit.authors.map((a) => ({
    ...compound([
      ["authorName", a.name],
      ["authorAffiliation", a.affiliation],
    ]),
    ...(a.orcid
      ? {
          authorIdentifierScheme: citationField("authorIdentifierScheme", "ORCID", { typeClass: "controlledVocabulary" }),
          authorIdentifier: citationField("authorIdentifier", a.orcid),
        }
      : {}),
  }));

  return {
    datasetVersion: {
      license: deposit.license,
      metadataBlocks: {
        citation: {
          displayName: "Citation Metadata",
          fields: [
            citationField("title", deposit.title),
            citationField("author", authors, { multiple: true, typeClass: "compound" }),
            citationField(
              "datasetContact",
              [compound([["datasetContactName", deposit.contact.name], ["datasetContactEmail", deposit.contact.email]])],
              { multiple: true, typeClass: "compound" },
            ),
            citationField("dsDescription", [compound([["dsDescriptionValue", description]])], {
              multiple: true,
              typeClass: "compound",
            }),
            citationField("subject", deposit.subject, { multiple: true, typeClass: "controlledVocabulary" }),
            citationField(
              "keyword",
              deposit.keywords.map((k) => compound([["keywordValue", k]])),
              { multiple: true, typeClass: "compound" },
            ),
            citationField("kindOfData", deposit.kindOfData, { multiple: true }),
            citationField(
              "dateOfCollection",
              [compound([["dateOfCollectionStart", collectionDate], ["dateOfCollectionEnd", collectionDate]])],
              { multiple: true, typeClass: "compound" },
            ),
            citationField(
              "timePeriodCovered",
              [compound([["timePeriodCoveredStart", collectionDate], ["timePeriodCoveredEnd", collectionDate]])],
              { multiple: true, typeClass: "compound" },
            ),
            citationField("dataSources", [
              "Public faculty-job listings on United States college and university career sites and applicant-tracking systems",
            ], { multiple: true }),
            citationField(
              "relatedMaterial",
              [
                `Faculty Atlas website: ${deposit.relatedUrls.website}`,
                `Collection and release code (source commit ${manifest.sourceCommit}): ${deposit.relatedUrls.code}`,
              ],
              { multiple: true },
            ),
            citationField("depositor", deposit.depositor),
            citationField("productionDate", manifest.date),
          ],
        },
        geospatial: {
          displayName: "Geospatial Metadata",
          fields: [
            citationField(
              "geographicCoverage",
              [
                {
                  country: citationField("country", "United States", { typeClass: "controlledVocabulary" }),
                  otherGeographicCoverage: citationField("otherGeographicCoverage", "50 states and the District of Columbia"),
                },
              ],
              { multiple: true, typeClass: "compound" },
            ),
          ],
        },
      },
    },
  };
}

function buildDescription({ manifest, stats }) {
  const unitidPct = `${(stats.unitidShare * 100).toFixed(1)}%`;
  return [
    `Point-in-time metadata for ${formatInt(stats.count)} publicly listed faculty job postings from ${formatInt(stats.institutions)} United States higher-education employers (colleges, universities, and some system- or district-level offices), captured on ${manifest.date}.`,
    "Faculty Atlas collects postings directly from institutional career sites and applicant-tracking systems (Workday, PageUp, Taleo, PeopleAdmin, SchoolJobs, iCIMS, Interfolio, and others), normalizes them to one schema, assigns stable identifiers, and classifies discipline, position type, and appointment track (tenure-track, non-tenure-track, variable, or unclassified).",
    `Each record gives the position title, institution, IPEDS UNITID with institutional control and level (matched for ${unitidPct} of records), location and state, department, discipline, position type, appointment track with its evidence family, posting/closing/start dates, the date Faculty Atlas first observed the posting, and a link to the official source. Full posting descriptions are not included.`,
    "The collection is broad but not a census; see the README for scope, method, validation results, and known limitations.",
    "New snapshots are added as versions of this dataset each quarter.",
  ].join(" ");
}

function doiUrl(pid) {
  const doi = String(pid || "").match(/^doi:(.+)$/i)?.[1];
  return doi ? `https://doi.org/${doi}` : null;
}

function buildReadme({ deposit, manifest, stats, fileRows, dataDictionary, validation }) {
  const tc = manifest.appointmentTrackCounts;
  const pct = (v) => `${(v * 100).toFixed(1)}%`;
  const authorList = deposit.authors.map((a) => a.name).join("; ");
  const year = manifest.date.slice(0, 4);
  return `# ${deposit.title}

Snapshot date: **${manifest.date}** · Schema version: **${manifest.schemaVersion}** · Methodology version: **${manifest.methodologyVersion}**

## Summary

This dataset is a point-in-time snapshot of publicly listed faculty job postings at United States higher-education institutions, collected by Faculty Atlas (${deposit.relatedUrls.website}).

- Records: ${formatInt(stats.count)} postings
- Institutions: ${formatInt(stats.institutions)} (${pct(stats.unitidShare)} of records carry an IPEDS UNITID)
- Geography: ${stats.states} jurisdictions (the 50 states and Washington, D.C.)
- Snapshot captured: ${manifest.scrapedAt}

Unit of observation: one publicly listed faculty-job record open on its source site at snapshot time. Postings that had closed before the snapshot are not included.

## Files

| File | Description |
|---|---|
${fileRows.map((r) => `| \`${r.name}\` | ${r.description} |`).join("\n")}

The CSV and JSON contain the same records. Empty CSV cells correspond to JSON \`null\`. Dataverse converts the CSV to a tab-delimited file for online exploration; the original CSV remains downloadable.

## Collection method

1. **Sources.** Institution-owned career sites and applicant-tracking systems, discovered from the IPEDS universe of active, degree-granting public and nonprofit two- and four-year institutions in the 50 states and D.C.
2. **Scraping.** Automated collection with Playwright on a recurring schedule (roughly every other day).
3. **Normalization.** Institution names, locations, and dates are normalized; each posting gets a stable \`canonicalJobId\`, and probable duplicates share a \`canonicalGroupId\`.
4. **Classification.** Discipline and position type come from source fields, deterministic rules, and AI-assisted extraction. Appointment track is recomputed at release time by a versioned deterministic classifier using explicit posting language, structured fields, title rules, and source-cited institution tenure policies. \`appointmentTrackEvidence\` records which rule family applied.
5. **Release export.** Only research metadata and source links are exported. Each record is linked to its institution's IPEDS UNITID, control, and level by exact name or alias match against the project's IPEDS-derived institution list. Postings that the automated quality audit flags as not being open faculty jobs, such as notices for positions already filled, are excluded (${manifest.diagnostics?.postQualityQuarantine?.excludedCount ?? 0} in this snapshot). Repeated captures of a single \`canonicalJobId\` are collapsed to the most complete record (${manifest.diagnostics?.duplicateCanonicalIdsRemoved?.count ?? 0} removed in this snapshot).

Code for every step is public at ${deposit.relatedUrls.code}. This snapshot was produced from commit \`${manifest.sourceCommit}\`.

## Appointment track

| Value | Records |
|---|---:|
| tenure-track | ${formatInt(tc.tenureTrack)} |
| non-tenure-track | ${formatInt(tc.nonTenureTrack)} |
| variable (posting leaves track open) | ${formatInt(tc.variable)} |
| unclassified (insufficient evidence) | ${formatInt(tc.unclassified)} |

For binary tenure-track shares, use only the first two groups as the denominator, and report the variable and unclassified counts alongside.

## Field completeness

| Field | Non-empty |
|---|---:|
${Object.entries(stats.completeness).map(([f, v]) => `| \`${f}\` | ${pct(v)} |`).join("\n")}

## Variables

${dataDictionary.replace(/^# Data Dictionary\s*/m, "").replace(/^## /gm, "### ").trim()}

${validation.replace(/^# Release Validation\s*/m, "## Validation\n\n").replace(/^Accuracy and coverage evidence[^\n]*\n\n/m, "").replace(/^## (?!Validation)/gm, "### ").trim()}

## Known limitations

- Coverage is broad but not a census. A missing institution or posting can reflect an unavailable source, technical blocking, a policy exclusion, or no visible opening at collection time.
- Dates, departments, disciplines, and position types may be absent or normalized from uneven source metadata. Do not infer a precise day where the source gave none.
- Appointment-track classification is benchmarked but not error-free.
- \`firstSeen\` is the first Faculty Atlas observation, not necessarily the institution's original posting date, and observation history begins on ${stats.firstSeenMin}.${stats.firstSeenAtMin >= 0.1 ? ` ${pct(stats.firstSeenAtMin)} of records share that earliest value, so for them \`firstSeen\` is a lower bound only.` : ""} Use \`datePosted\` where available for posting age.
- \`canonicalGroupId\` reduces obvious repetition but is not a perfect vacancy-level identifier; one vacancy can appear under several titles or sources.
- Source URLs can close or redirect after the snapshot.

## Integrity

\`SHA256SUMS.txt\` lists SHA-256 checksums for every file in this deposit. On macOS or Linux, verify with:

\`\`\`
shasum -a 256 -c SHA256SUMS.txt
\`\`\`

## License and terms

Released under ${deposit.license.name} (${deposit.license.uri}). The license covers this compilation and its derived metadata. Linked job postings remain the property of the originating institutions, and their full text is not redistributed here.

## Citation

${authorList} (${year}). *${deposit.title}* (snapshot ${manifest.date}). Harvard Dataverse. ${doiUrl(deposit.datasetPid) || "[DOI assigned on publication]"}

Please cite the snapshot date and dataset version you used.
`;
}

// Helper for upload.sh. Given a package file name and the draft/published file
// listings, prints "<action> <fileId>": replace (published file with the same
// role), readd (unpublished draft file, which Dataverse cannot replace), or add.
// With --leftover, prints draft files that match no package file.
const UPLOAD_PLAN_PY = `import json, re, sys

def role(name):
    # A CSV whose tabular ingest failed can be listed only under its .tab name.
    name = re.sub(r"\\.tab$", ".csv", name)
    return re.sub(r"_\\d{4}-\\d{2}-\\d{2}", "", name)

def files(listing):
    out = {}
    for entry in json.loads(listing).get("data", []):
        df = entry.get("dataFile", {})
        # Ingested CSVs are listed as .tab; originalFileName keeps the upload name.
        name = df.get("originalFileName") or df.get("filename") or entry.get("label", "")
        out[role(name)] = (df.get("id"), name)
    return out

if sys.argv[1] == "--leftover":
    wanted = {role(n) for n in sys.argv[3:]}
    print(" ".join(name for r, (_, name) in files(sys.argv[2]).items() if r not in wanted))
else:
    name, draft, published = sys.argv[1], files(sys.argv[2]), files(sys.argv[3])
    file_id = draft.get(role(name), (None, None))[0]
    published_ids = {fid for fid, _ in published.values()}
    if file_id is None:
        print("add -")
    elif file_id in published_ids:
        print(f"replace {file_id}")
    else:
        print(f"readd {file_id}")
`;

function buildUploadScript({ fileRows }) {
  const lines = fileRows
    .map((r) => {
      const jsonData = JSON.stringify({ description: r.description, categories: [r.category] }).replace(/'/g, "'\\''");
      return `sync_file "${r.name}" '${jsonData}'`;
    })
    .join("\n");
  return `#!/usr/bin/env bash
# Fill a DRAFT Harvard Dataverse dataset with this package's metadata and
# files. For a published dataset this starts a new draft version and replaces
# the previous snapshot's files. Nothing is published: review the draft in the
# web UI, then click Publish.
#
#   export DATAVERSE_API_TOKEN=...   # Account > API Token on the Dataverse site
#   bash upload.sh                   # metadata and every file
#   bash upload.sh NAME...           # metadata and only the named files
set -euo pipefail
cd "$(dirname "$0")"

: "\${DATAVERSE_API_TOKEN:?Set DATAVERSE_API_TOKEN (Dataverse: Account > API Token)}"
SERVER="\${DATAVERSE_SERVER:-$(python3 -c 'import json;print(json.load(open("deposit.json"))["server"])')}"
COLLECTION="\${DATAVERSE_COLLECTION:-$(python3 -c 'import json;print(json.load(open("deposit.json"))["collection"] or "")')}"
DATASET_PID="\${DATASET_PID:-$(python3 -c 'import json;print(json.load(open("deposit.json"))["datasetPid"] or "")')}"

missing=$(python3 -c 'import json;print("\\n".join(json.load(open("deposit.json"))["missing"]))')
if [[ -n "$missing" ]]; then
  echo "Deposit metadata is incomplete; fill data/dataverse-deposit.json and re-run the packager:" >&2
  printf '  - %s\\n' $missing >&2
  exit 1
fi

( cd files && shasum -a 256 -c SHA256SUMS.txt >/dev/null ) || { echo "Checksum mismatch in files/" >&2; exit 1; }

if [[ -n "$DATASET_PID" ]]; then
  echo "Updating draft metadata for $DATASET_PID on $SERVER ..."
  curl -sS --fail-with-body -H "X-Dataverse-key: $DATAVERSE_API_TOKEN" \\
    -X PUT "$SERVER/api/datasets/:persistentId/versions/:draft?persistentId=$DATASET_PID" \\
    -H "Content-Type: application/json" --upload-file dataset-version.json >/dev/null
else
  : "\${COLLECTION:?Set datasetPid or collection in data/dataverse-deposit.json}"
  echo "Creating draft dataset in collection '$COLLECTION' on $SERVER ..."
  response=$(curl -sS --fail-with-body -H "X-Dataverse-key: $DATAVERSE_API_TOKEN" \\
    -X POST "$SERVER/api/dataverses/$COLLECTION/datasets" \\
    -H "Content-Type: application/json" --upload-file dataset.json)
  DATASET_PID=$(printf '%s' "$response" | python3 -c 'import json,sys;print(json.load(sys.stdin)["data"]["persistentId"])')
  echo "Draft created: $DATASET_PID"
  echo "(If an upload below fails, re-run with DATASET_PID=$DATASET_PID to add files to this draft.)"
fi

api() {
  curl -sS --fail-with-body -H "X-Dataverse-key: $DATAVERSE_API_TOKEN" "$@"
}

# Files already in the draft (carried over from the last published version, or
# from an earlier run of this script) are matched to package files by name with
# the snapshot date removed, so a new snapshot replaces the previous one.
draft_files=$(api "$SERVER/api/datasets/:persistentId/versions/:draft/files?persistentId=$DATASET_PID")
# Fails with 404 until the dataset has been published once.
published_files=$(api "$SERVER/api/datasets/:persistentId/versions/:latest-published/files?persistentId=$DATASET_PID" 2>/dev/null) \\
  || published_files='{"data":[]}'


ONLY=("$@")

sync_file() {
  local name="$1" json="$2" action id
  if (( \${#ONLY[@]} )) && [[ " \${ONLY[*]} " != *" $name "* ]]; then return; fi
  read -r action id < <(python3 upload-plan.py "$name" "$draft_files" "$published_files")
  case "$action" in
    replace)
      echo "Replacing $name (file $id) ..."
      api -X POST "$SERVER/api/files/$id/replace" -F "file=@files/$name" \\
        -F "jsonData=$(python3 -c 'import json,sys;d=json.loads(sys.argv[1]);d["forceReplace"]=True;print(json.dumps(d))' "$json")" >/dev/null ;;
    readd)
      echo "Re-adding $name (removing unpublished draft file $id) ..."
      api -X DELETE "$SERVER/api/files/$id" >/dev/null
      api -X POST "$SERVER/api/datasets/:persistentId/add?persistentId=$DATASET_PID" \\
        -F "file=@files/$name" -F "jsonData=$json" >/dev/null ;;
    *)
      echo "Uploading $name ..."
      api -X POST "$SERVER/api/datasets/:persistentId/add?persistentId=$DATASET_PID" \\
        -F "file=@files/$name" -F "jsonData=$json" >/dev/null ;;
  esac
}

${lines}

(( \${#ONLY[@]} )) && { echo; echo "Done. Review the draft: $SERVER/dataset.xhtml?persistentId=$DATASET_PID&version=DRAFT"; exit 0; }

leftover=$(python3 upload-plan.py --leftover "$draft_files" ${fileRows.map((r) => `"${r.name}"`).join(" ")})
if [[ -n "$leftover" ]]; then
  echo
  echo "These draft files match nothing in this package; delete them in the web UI if they are obsolete:"
  printf '  - %s\\n' $leftover
fi

echo
echo "Done. Review the draft, then publish from the web UI:"
echo "  $SERVER/dataset.xhtml?persistentId=$DATASET_PID&version=DRAFT"
`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const releasesDir = path.resolve(ROOT, args.releases || "data/releases");
  const date = args.date || readJson(path.join(releasesDir, "index.json")).latest;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
    throw new Error(`Invalid --date value: "${date}". Use YYYY-MM-DD.`);
  }
  const deposit = readDepositConfig(path.resolve(ROOT, args.config || "data/dataverse-deposit.json"));
  const outDir = path.resolve(ROOT, args.outdir || "generated/dataverse", date);
  const filesDir = path.join(outDir, "files");

  const release = (ext) => path.join(releasesDir, `${date}.${ext}`);
  for (const ext of ["json", "csv", "metadata.json"]) {
    if (!fs.existsSync(release(ext))) {
      throw new Error(`Missing ${path.relative(ROOT, release(ext))}; run: npm run release:dataset -- --date ${date}`);
    }
  }
  const manifest = readJson(release("metadata.json"));
  for (const kind of ["json", "csv"]) {
    if (sha256(release(kind)) !== manifest.hashes[kind].value) {
      throw new Error(`${path.basename(release(kind))} does not match the checksum in its release manifest.`);
    }
  }
  const { jobs } = readJson(release("json"));
  const stats = summarize(jobs);
  const dataDictionary = fs.readFileSync(path.join(ROOT, "data", "data-dictionary.md"), "utf8");
  const validation = fs.readFileSync(path.join(ROOT, "data", "release-validation.md"), "utf8");

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(filesDir, { recursive: true });

  const base = `faculty-atlas-jobs_${date}`;
  const fileRows = [
    { name: "README.md", category: "Documentation", description: "Overview, collection method, variables, limitations, license, and citation." },
    { name: `${base}.csv`, category: "Data", description: `Job posting records, one row per posting (${formatInt(stats.count)} rows).` },
    { name: `${base}.json`, category: "Data", description: "The same records as structured JSON with snapshot provenance fields." },
    { name: `${base}.metadata.json`, category: "Documentation", description: "Release manifest: provenance, source commit, field list, classification counts, diagnostics, and file hashes." },
    { name: "data-dictionary.md", category: "Documentation", description: "Field definitions for the data files." },
    { name: "release-schema.json", category: "Documentation", description: "JSON Schema (2020-12) for the JSON data file." },
    { name: "SHA256SUMS.txt", category: "Documentation", description: "SHA-256 checksums for every file in the deposit." },
  ];

  fs.copyFileSync(release("csv"), path.join(filesDir, `${base}.csv`));
  fs.copyFileSync(release("json"), path.join(filesDir, `${base}.json`));
  fs.copyFileSync(release("metadata.json"), path.join(filesDir, `${base}.metadata.json`));
  fs.copyFileSync(path.join(ROOT, "data", "data-dictionary.md"), path.join(filesDir, "data-dictionary.md"));
  fs.copyFileSync(path.join(ROOT, "data", "release-schema.json"), path.join(filesDir, "release-schema.json"));
  fs.writeFileSync(
    path.join(filesDir, "README.md"),
    buildReadme({ deposit, manifest, stats, fileRows, dataDictionary, validation }),
    "utf8",
  );
  const checksums = fileRows
    .filter((r) => r.name !== "SHA256SUMS.txt")
    .map((r) => `${sha256(path.join(filesDir, r.name))}  ${r.name}`)
    .join("\n");
  fs.writeFileSync(path.join(filesDir, "SHA256SUMS.txt"), `${checksums}\n`, "utf8");

  const description = buildDescription({ manifest, stats });
  const datasetJson = buildDatasetJson({ deposit, manifest, stats, description });
  writeJson(path.join(outDir, "dataset.json"), datasetJson);
  writeJson(path.join(outDir, "dataset-version.json"), datasetJson.datasetVersion);
  const missing = missingDepositFields(deposit);
  writeJson(path.join(outDir, "deposit.json"), {
    server: deposit.server,
    datasetPid: deposit.datasetPid || null,
    collection: deposit.collection,
    missing,
  });
  fs.writeFileSync(path.join(outDir, "upload.sh"), buildUploadScript({ fileRows }), { encoding: "utf8", mode: 0o755 });
  fs.writeFileSync(path.join(outDir, "upload-plan.py"), UPLOAD_PLAN_PY, "utf8");

  console.log(`Packaged ${date} for Dataverse: ${path.relative(ROOT, outDir)}`);
  console.log(`- ${formatInt(stats.count)} records, ${formatInt(stats.institutions)} institutions, ${stats.states} states`);
  console.log(`- ${fileRows.length} files in files/, plus dataset.json and upload.sh`);
  if (missing.length) {
    console.log(`\nFill these in data/dataverse-deposit.json (private values in data/dataverse-deposit.local.json), then re-run (upload.sh refuses until they are set):`);
    for (const field of missing) console.log(`  - ${field}`);
  }
}

main();
