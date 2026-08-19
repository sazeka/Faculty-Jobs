import { test } from "node:test";
import assert from "node:assert/strict";
import { extractCsodJobsFromDocument } from "../lib/csod-extraction.js";

function anchor(href, title, containerText = "") {
  const container = { innerText: containerText };
  return {
    textContent: title,
    parentElement: container,
    getAttribute(name) {
      return name === "href" ? href : null;
    },
    closest() {
      return container;
    },
  };
}

function fixture(...anchors) {
  return {
    querySelectorAll(selector) {
      assert.equal(selector, "a[href]");
      return anchors;
    },
  };
}

test("extracts a legacy CSOD WebForms JobDetails URL", () => {
  const postback =
    'javascript:WebForm_DoPostBackWithOptions(new WebForm_PostBackOptions("ctl00$Content$Jobs", "", true, "", "JobDetails.aspx?site=1&id=12345", false, true))';
  const doc = fixture(anchor(postback, "Assistant Professor of Biology", "Department: Biological Sciences"));

  assert.deepEqual(
    extractCsodJobsFromDocument(doc, "https://example.csod.com/ats/careersite/search.aspx"),
    [
      {
        title: "Assistant Professor of Biology",
        url: "https://example.csod.com/ats/careersite/JobDetails.aspx?site=1&id=12345",
        dept: "Biological Sciences",
      },
    ]
  );
});

test("keeps normal links, rejects unrelated javascript links, and deduplicates", () => {
  const normal = "https://example.csod.com/ux/ats/careersite/1/home/requisition/987";
  const doc = fixture(
    anchor(normal, "Professor of Chemistry"),
    anchor(normal, "Professor of Chemistry duplicate"),
    anchor("javascript:void(0)", "Open menu")
  );

  assert.deepEqual(extractCsodJobsFromDocument(doc, "https://example.csod.com/search"), [
    { title: "Professor of Chemistry", url: normal, dept: null },
  ]);
});
