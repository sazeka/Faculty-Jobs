import { readFile, writeFile } from "node:fs/promises";

const JOBS_PATH = new URL("../public/jobs.json", import.meta.url);
const OUT_PATHS = [
  new URL("../public/college-coords.json", import.meta.url),
  new URL("../docs/college-coords.json", import.meta.url),
];

const USER_AGENT = "FacultyAtlas/1.0 (local geocode utility)";
const PAUSE_MS = 1100;
const REFRESH = process.argv.includes("--refresh");

const stateMap = {
  "AZ": "Arizona",
  "CA - CSU": "California",
  "UC": "California",
  "CA Private": "California",
  "CO": "Colorado",
  "CT": "Connecticut",
  "CT State": "Connecticut",
  "DE": "Delaware",
  "ID": "Idaho",
  "IL": "Illinois",
  "IN": "Indiana",
  "MA": "Massachusetts",
  "UMass": "Massachusetts",
  "ME": "Maine",
  "NH": "New Hampshire",
  "MI": "Michigan",
  "MN": "Minnesota",
  "MT": "Montana",
  "NM": "New Mexico",
  "NV": "Nevada",
  "NJ": "New Jersey",
  "NC": "North Carolina",
  "NY": "New York",
  "OH": "Ohio",
  "OR": "Oregon",
  "PA": "Pennsylvania",
  "RI": "Rhode Island",
  "UT": "Utah",
  "WA": "Washington",
  "WI": "Wisconsin",
  "Claremont Colleges": "California",
  "Claremont": "California"
};

const manualOverrides = {
  "CT State Asnuntuck": {
    lat: 41.9983,
    lon: -72.5715,
    displayName: "Asnuntuck Community College, Enfield, Connecticut, United States"
  },
  "CT State Capital": {
    lat: 41.7647,
    lon: -72.6734,
    displayName: "Capital Community College, Hartford, Connecticut, United States"
  },
  "CT State Community College": {
    lat: 41.7650,
    lon: -72.6738,
    displayName: "CT State Community College System, Hartford, Connecticut, United States"
  },
  "CT State Housatonic": {
    lat: 41.1763,
    lon: -73.1894,
    displayName: "Housatonic Community College, Bridgeport, Connecticut, United States"
  },
  "CT State Manchester": {
    lat: 41.7686,
    lon: -72.5538,
    displayName: "Manchester Community College, Manchester, Connecticut, United States"
  },
  "CT State Naugatuck Valley": {
    lat: 41.5549,
    lon: -73.0414,
    displayName: "Naugatuck Valley Community College, Waterbury, Connecticut, United States"
  },
  "CT State Norwalk": {
    lat: 41.1177,
    lon: -73.4074,
    displayName: "Norwalk Community College, Norwalk, Connecticut, United States"
  },
  "CT State Quinebaug Valley": {
    lat: 41.8080,
    lon: -71.8870,
    displayName: "Quinebaug Valley Community College, Danielson, Connecticut, United States"
  },
  "CT State Three Rivers": {
    lat: 41.5234,
    lon: -72.0938,
    displayName: "Three Rivers Community College, Norwich, Connecticut, United States"
  },
  "Rutgers, The State University of New Jersey": {
    lat: 40.5008,
    lon: -74.4474,
    displayName: "Rutgers University, New Brunswick, New Jersey, United States"
  },
  "Stony Brook University (SUNY)": {
    lat: 40.9126,
    lon: -73.1235,
    displayName: "Stony Brook University, Stony Brook, New York, United States"
  },
  "CT State Tunxis": {
    lat: 41.7250,
    lon: -72.8580,
    displayName: "Tunxis Community College, Farmington, Connecticut, United States"
  },
  "St. John's University": {
    lat: 40.7210,
    lon: -73.7950,
    displayName: "St. John's University, Queens, New York, United States"
  },
  "Minnesota State System": {
    lat: 44.9537,
    lon: -93.0900,
    displayName: "Minnesota State Colleges and Universities System Office, Saint Paul, Minnesota, United States"
  },
  "SUNY Finger Lakes Community College": {
    lat: 42.9284,
    lon: -77.2946,
    displayName: "Finger Lakes Community College, Canandaigua, New York, United States"
  },
  "SUNY Westchester Community College": {
    lat: 41.0330,
    lon: -73.7629,
    displayName: "SUNY Westchester Community College, White Plains, New York, United States"
  },
  "SUNY Orange County Community College": {
    lat: 41.4544,
    lon: -74.4185,
    displayName: "SUNY Orange County Community College, Middletown, New York, United States"
  },
  "SUNY Erie Community College": {
    lat: 42.9642,
    lon: -78.7354,
    displayName: "SUNY Erie Community College, Williamsville, New York, United States"
  },
  "SUNY Downstate Health Sciences University": {
    lat: 40.6553,
    lon: -73.9442,
    displayName: "SUNY Downstate Health Sciences University, Brooklyn, New York, United States"
  },
  "SUNY Empire State College": {
    lat: 43.0831,
    lon: -73.7846,
    displayName: "SUNY Empire State College, Saratoga Springs, New York, United States"
  },
  "SUNY Cayuga": {
    lat: 42.9317,
    lon: -76.5660,
    displayName: "SUNY Cayuga, Auburn, New York, United States"
  },
  "SUNY Jefferson Community College": {
    lat: 43.9695,
    lon: -75.9191,
    displayName: "SUNY Jefferson Community College, Watertown, New York, United States"
  },
  "SUNY Broome Community College": {
    lat: 42.0987,
    lon: -75.9179,
    displayName: "SUNY Broome Community College, Broome County, New York, United States"
  },
  "SUNY Genesee Community College": {
    lat: 43.0009,
    lon: -78.1910,
    displayName: "SUNY Genesee Community College, Batavia, New York, United States"
  },
  "SUNY Onondaga Community College": {
    lat: 43.0017,
    lon: -76.1963,
    displayName: "SUNY Onondaga Community College, Onondaga, New York, United States"
  },
  "SUNY Niagara": {
    lat: 43.1337,
    lon: -78.8838,
    displayName: "SUNY Niagara, Sanborn, New York, United States"
  },
  "SUNY Dutchess Community College": {
    lat: 41.7643,
    lon: -73.7466,
    displayName: "SUNY Dutchess Community College, Dutchess County, New York, United States"
  },
  "University of New Mexico": {
    lat: 35.0866,
    lon: -106.6202,
    displayName: "University of New Mexico, Albuquerque, New Mexico, United States"
  },
  "New Mexico State University": {
    lat: 32.2834,
    lon: -106.7410,
    displayName: "New Mexico State University, Las Cruces, New Mexico, United States"
  },
  "St. John's College (Santa Fe)": {
    lat: 35.6645,
    lon: -105.9407,
    displayName: "St. John's College, Santa Fe, New Mexico, United States"
  },
  "Nevada State University": {
    lat: 36.0094,
    lon: -114.9553,
    displayName: "Nevada State University, Henderson, Nevada, United States"
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readJson(url, fallback) {
  try {
    const raw = await readFile(url, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function buildCollegeIndex(jobs) {
  const byCollege = new Map();
  for (const job of jobs) {
    const college = clean(job?.college);
    if (!college) continue;
    if (!byCollege.has(college)) {
      byCollege.set(college, {
        count: 0,
        states: new Map(),
        locations: new Map()
      });
    }
    const entry = byCollege.get(college);
    entry.count += 1;

    const rawState = clean(job?.source);
    const mappedState = stateMap[rawState] || rawState;
    if (mappedState) {
      entry.states.set(mappedState, (entry.states.get(mappedState) || 0) + 1);
    }

    const location = clean(job?.location);
    if (location) {
      entry.locations.set(location, (entry.locations.get(location) || 0) + 1);
    }
  }
  return byCollege;
}

function mostFrequent(map) {
  if (!map || map.size === 0) return "";
  const sorted = [...map.entries()].sort((a, b) => b[1] - a[1]);
  return sorted[0][0];
}

async function geocode(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept-Language": "en-US,en;q=0.9"
    }
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) return null;
  const hit = data[0];
  return {
    lat: Number(hit.lat),
    lon: Number(hit.lon),
    displayName: hit.display_name || null
  };
}

function buildQueries(college, state, location) {
  const queries = [];
  if (location && state) queries.push(`${college}, ${location}, ${state}, United States`);
  if (state) queries.push(`${college}, ${state}, United States`);
  queries.push(`${college}, United States`);
  return [...new Set(queries)];
}

async function main() {
  const jobsData = await readJson(JOBS_PATH, { jobs: [] });
  const jobs = Array.isArray(jobsData.jobs) ? jobsData.jobs : [];
  const colleges = buildCollegeIndex(jobs);
  const existing = await readJson(OUT_PATHS[0], { generatedAt: null, colleges: {} });
  const cached = existing && typeof existing.colleges === "object" ? existing.colleges : {};

  const records = {};
  const names = [...colleges.keys()].sort((a, b) => a.localeCompare(b));
  let success = 0;
  let cachedCount = 0;

  console.log(`Unique colleges: ${names.length}`);
  for (const name of names) {
    const info = colleges.get(name);
    const state = mostFrequent(info.states);
    const location = mostFrequent(info.locations);
    const prev = cached[name];

    if (manualOverrides[name]) {
      records[name] = {
        ...manualOverrides[name],
        count: info.count,
        state,
        location,
        query: "manualOverride"
      };
      cachedCount += 1;
      continue;
    }

    if (!REFRESH && prev && Number.isFinite(prev.lat) && Number.isFinite(prev.lon)) {
      records[name] = {
        ...prev,
        count: info.count,
        state,
        location: location || prev.location || ""
      };
      cachedCount += 1;
      continue;
    }

    let point = null;
    const queries = buildQueries(name, state, location);
    for (const query of queries) {
      point = await geocode(query);
      if (point) {
        records[name] = {
          lat: point.lat,
          lon: point.lon,
          count: info.count,
          state,
          location,
          query,
          displayName: point.displayName
        };
        success += 1;
        console.log(`Geocoded: ${name} -> ${point.lat.toFixed(4)}, ${point.lon.toFixed(4)}`);
        break;
      }
      await sleep(PAUSE_MS);
    }

    if (!point) {
      records[name] = {
        lat: null,
        lon: null,
        count: info.count,
        state,
        location,
        query: null,
        displayName: null
      };
      console.log(`Missing: ${name}`);
    }

    await sleep(PAUSE_MS);
    await writeOutputs({
      generatedAt: new Date().toISOString(),
      sourceJobsCount: jobs.length,
      colleges: records
    });
  }

  await writeOutputs({
    generatedAt: new Date().toISOString(),
    sourceJobsCount: jobs.length,
    colleges: records
  });

  console.log(`Done. cached=${cachedCount}, new=${success}, total=${names.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
  async function writeOutputs(payload) {
    await Promise.all(OUT_PATHS.map((outPath) => writeFile(outPath, JSON.stringify(payload, null, 2))));
  }
