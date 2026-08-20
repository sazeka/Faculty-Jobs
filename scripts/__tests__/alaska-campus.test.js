import assert from "node:assert/strict";
import test from "node:test";

import { alaskaCampusLocation, inferAlaskaCampus } from "../lib/alaska-campus.js";

const systemJob = (url, title = "Faculty Position", location = "Anchorage, AK") => ({
  college: "University of Alaska System",
  url,
  title,
  location,
});

test("splits Alaska system jobs using the careers URL campus slug", () => {
  assert.equal(
    inferAlaskaCampus(systemJob("https://careers.alaska.edu/jobs/post-doctoral-fellow-fairbanks-alaska-united-states-123")),
    "University of Alaska Fairbanks"
  );
  assert.equal(
    inferAlaskaCampus(systemJob("https://careers.alaska.edu/jobs/term-professor-juneau-alaska-united-states")),
    "University of Alaska Southeast"
  );
  assert.equal(
    inferAlaskaCampus(systemJob("https://careers.alaska.edu/jobs/professor-anchorage-alaska-united-states")),
    "University of Alaska Anchorage"
  );
});

test("keeps genuinely multi-campus Alaska postings at the system level", () => {
  assert.equal(
    inferAlaskaCampus(systemJob("https://careers.alaska.edu/jobs/nursing-anchorage-alaska-united-states-juneau")),
    null
  );
});

test("provides canonical campus locations", () => {
  assert.equal(alaskaCampusLocation("University of Alaska Fairbanks"), "Fairbanks, AK");
  assert.equal(alaskaCampusLocation("University of Alaska Southeast"), "Juneau, AK");
});
