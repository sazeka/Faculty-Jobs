import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toInt,
  parseCsv,
  firstField,
  mapControl,
  mapLevel,
  isDegreeGrantingBySector,
  mapIpedsRows,
  buildLookupByName,
  parseIalias,
} from "../lib/ipeds.js";

test("toInt parses ints and rejects junk", () => {
  assert.equal(toInt("100654"), 100654);
  assert.equal(toInt(" 5 "), 5);
  assert.equal(toInt(""), null);
  assert.equal(toInt("abc"), null);
  assert.equal(toInt(null), null);
});

test("mapControl maps codes and falls back to sector", () => {
  assert.equal(mapControl("1"), "public");
  assert.equal(mapControl("2"), "private nonprofit");
  assert.equal(mapControl("3"), "private for-profit");
  // Unknown control -> infer from sector.
  assert.equal(mapControl("", "4"), "public");
  assert.equal(mapControl("", "5"), "private nonprofit");
  assert.equal(mapControl("", "6"), "private for-profit");
  assert.equal(mapControl("", ""), null);
});

test("mapLevel maps ICLEVEL codes", () => {
  assert.equal(mapLevel("1"), "4-year");
  assert.equal(mapLevel("2"), "2-year");
  assert.equal(mapLevel("3"), "less-than-2-year");
  assert.equal(mapLevel("9"), null);
  assert.equal(mapLevel(""), null);
});

test("isDegreeGrantingBySector classifies sectors", () => {
  assert.equal(isDegreeGrantingBySector("1"), true);
  assert.equal(isDegreeGrantingBySector("6"), true);
  assert.equal(isDegreeGrantingBySector("7"), false);
  assert.equal(isDegreeGrantingBySector("9"), false);
  assert.equal(isDegreeGrantingBySector(""), null);
});

test("parseCsv handles header, BOM, quotes, and CRLF", () => {
  const csv = '﻿UNITID,INSTNM,STABBR\r\n1,"Smith, College",MA\r\n2,Plain University,CA\r\n';
  const rows = parseCsv(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].UNITID, "1");
  assert.equal(rows[0].INSTNM, "Smith, College"); // comma inside quotes preserved
  assert.equal(rows[0].STABBR, "MA");
  assert.equal(rows[1].INSTNM, "Plain University");
});

test("firstField returns the first non-empty candidate", () => {
  const row = { A: "", B: " x ", C: "y" };
  assert.equal(firstField(row, ["A", "B", "C"]), "x");
  assert.equal(firstField(row, ["A", "missing"]), "");
});

test("mapIpedsRows drops for-profits and dedups", () => {
  const rows = [
    { UNITID: "1", INSTNM: "Public U", STABBR: "TX", CONTROL: "1", ICLEVEL: "1", SECTOR: "1" },
    { UNITID: "2", INSTNM: "For Profit Inc", STABBR: "FL", CONTROL: "3", ICLEVEL: "1", SECTOR: "3" },
    { UNITID: "1", INSTNM: "Public U (dupe)", STABBR: "TX", CONTROL: "1", ICLEVEL: "1", SECTOR: "1" },
  ];
  const mapped = mapIpedsRows(rows);
  assert.equal(mapped.length, 1, "for-profit dropped, unitid dupe collapsed");
  assert.equal(mapped[0].name, "Public U");
  assert.equal(mapped[0].state, "TX");
  assert.equal(mapped[0].control, "public");
  assert.equal(mapped[0].level, "4-year");
  assert.equal(mapped[0].is_degree_granting, true);
});

test("buildLookupByName keys case-insensitively", () => {
  const lookup = buildLookupByName([{ name: "Big State University", state: "OH" }]);
  assert.equal(lookup.get("big state university").state, "OH");
  assert.equal(lookup.has("nope"), false);
});

test("parseIalias splits on pipe, 2+ spaces, and semicolon but not a single space", () => {
  assert.deepEqual(parseIalias("UCI  UC Irvine"), ["UCI", "UC Irvine"]);
  assert.deepEqual(parseIalias("AUM||Auburn University at Montgomery|Auburn Montgomery"), [
    "AUM",
    "Auburn University at Montgomery",
    "Auburn Montgomery",
  ]);
  assert.deepEqual(parseIalias("Foo; Bar"), ["Foo", "Bar"]);
  assert.deepEqual(parseIalias("Single Alias"), ["Single Alias"]);
  assert.deepEqual(parseIalias(""), []);
});

test("buildLookupByName falls back to an unambiguous alias", () => {
  const lookup = buildLookupByName([
    { name: "University of California-Berkeley", unitid: 1, aliases: ["UC Berkeley"], state: "CA" },
  ]);
  assert.equal(lookup.get("uc berkeley").unitid, 1);
});

test("buildLookupByName never lets an alias shadow a real INSTNM", () => {
  const lookup = buildLookupByName([
    { name: "University of Alabama", unitid: 1, aliases: [] },
    { name: "UA", unitid: 2, aliases: ["University of Alabama"] },
  ]);
  // "UA"'s alias collides with a real institution's own name — must not overwrite it.
  assert.equal(lookup.get("university of alabama").unitid, 1);
});

test("buildLookupByName drops an alias that's ambiguous across institutions", () => {
  const lookup = buildLookupByName([
    { name: "Tech College A", unitid: 1, aliases: ["Tech"] },
    { name: "Tech College B", unitid: 2, aliases: ["Tech"] },
  ]);
  assert.equal(lookup.has("tech"), false);
});
