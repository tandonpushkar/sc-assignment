const test = require("node:test");
const assert = require("node:assert/strict");
const { extractPacket } = require("./scripts/extract-packet");
test("raw bytes through PDF text and OCR yield the complete expected exception register", () => {
  const records = extractPacket("./fixtures/manifest.json");
  assert.deepEqual(
    records.map((r) => [r.id, r.flags]),
    [
      ["invoice", [{ label: "Total (USD)", reason: "Conflict" }]],
      ["order", []],
      ["fuel", [{ label: "Tax (USD)", reason: "Missing" }]],
      ["rebar-073", [{ label: "Total (USD)", reason: "Conflict" }]],
      [
        "co-014",
        [{ label: "Revised contract (USD)", reason: "Amount mismatch" }],
      ],
    ],
  );
  const amounts = records[0].fields.find(
    (f) => f.label === "Total (USD)",
  ).evidence;
  assert.deepEqual(
    amounts.map((e) => [e.file, e.method, e.raw]),
    [
      ["site-invoice.pdf", "PDF text", "$1,250.00"],
      ["accounts-scan.jpg", "OCR", "$1,205.00"],
    ],
  );
});
const { score } = require("./scripts/evaluate");
test("separate evaluation packet recovers the hand-labeled review decisions", () => {
  assert.deepEqual(
    score(
      extractPacket("./evaluation/manifest.json"),
      require("./evaluation/labels.json"),
    ),
    { records: 5, caught: 4, missed: 0, unnecessary: 0 },
  );
});
test("evaluation counts misses and unnecessary flags independently", () => {
  assert.deepEqual(
    score([{ id: "r", flags: [{ label: "Date", reason: "Conflict" }] }], {
      r: { Date: "Missing" },
    }),
    { records: 1, caught: 0, missed: 1, unnecessary: 1 },
  );
});
test("mixed PDF calculates its change order using text and OCR on the same page", () => {
  const { execFileSync } = require("node:child_process");
  const pages = JSON.parse(
    execFileSync(
      ".venv/bin/python",
      [
        "-c",
        "from pathlib import Path; import json; from service.extract import read_pages; print(json.dumps(read_pages(Path('evaluation/ocr/mixed-contract.pdf').read_bytes(),'application/pdf')))",
      ],
      { encoding: "utf8" },
    ),
  );
  const { review } = require("./review");
  const revised = review({
    kind: "Change order",
    decisions: {},
    docs: [{ name: "mixed-contract.pdf", pages }],
  }).at(-1);
  assert.equal(revised.issue, "Amount mismatch");
  assert.equal(revised.checks[0].expected, "41500.00");
  assert.deepEqual(
    revised.checks[0].inputs.map((e) => e.method),
    ["PDF text", "OCR", "OCR"],
  );
});
