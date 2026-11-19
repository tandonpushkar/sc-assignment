const test = require("node:test");
const assert = require("node:assert/strict");
const { review, normalize, resolve, attach, flagged } = require("./review");
const [invoice, order, receipt] = require("./fixtures/packet.json");
test("invoice keeps conflicting PDF and OCR evidence", () => {
  const flags = review(invoice).filter(flagged);
  assert.equal(flags.length, 1);
  assert.deepEqual(
    flags[0].evidence.map((e) => [e.raw, e.page, e.method]),
    [
      ["$1,250.00", 1, "PDF text"],
      ["$1,205.00", 1, "OCR"],
    ],
  );
  assert.ok(flags[0].evidence.every((e) => e.line > 0));
});
test("complete purchase order extracts all six fields", () => {
  assert.deepEqual(
    review(order).map((f) => f.value),
    [
      "North Quarry Supply",
      "PO-221",
      "2026-11-04",
      "Graded aggregate",
      "25 tons",
      "$1,250.00",
    ],
  );
});
test("missing tax remains empty and needs review", () => {
  const [tax] = review(receipt).filter(flagged);
  assert.deepEqual(
    [tax.label, tax.status, tax.value],
    ["Tax (USD)", "Missing", ""],
  );
});
test("equivalent currency formats agree, malformed values require review", () => {
  assert.equal(
    normalize("Total (USD)", "$01,250"),
    normalize("Total (USD)", "USD 1250.00"),
  );
  const copy = { name: "copy", pages: [{ method: "OCR", text: "Total: $1O" }] };
  assert.equal(review(attach(order, copy)).at(-1).status, "Check format");
});
test("invalid or ambiguous dates require review", () => {
  for (const d of ["02/03/26", "2026-02-30"])
    assert.equal(normalize("Date", d), null);
});
test("manual resolution retains evidence and refuses malformed amounts", () => {
  assert.throws(() => resolve(invoice, "Total (USD)", "abc"));
  const result = review(resolve(invoice, "Total (USD)", "$1,250.00")).at(-1);
  assert.deepEqual(
    [result.value, result.status, result.evidence.length],
    ["$1,250.00", "Reviewed", 2],
  );
});
test("duplicate import is idempotent, new evidence reopens decisions", () => {
  const saved = resolve(receipt, "Tax (USD)", "0.00");
  assert.equal(attach(saved, receipt.docs[0]), saved);
  assert.deepEqual(attach(saved, invoice.docs[0]).decisions, {});
});

const { reviewQueue } = require("./review");
const rebar = require("./fixtures/packet.json")[3];
const withPages = (...texts) => ({
  ...invoice,
  docs: [
    { name: "job.txt", pages: texts.map((text) => ({ method: "Text", text })) },
  ],
});
const field = (r, label) => review(r).find((f) => f.label === label);
test("OCR separators, aligned columns and case variants agree across the rebar copies", () => {
  assert.deepEqual(
    review(rebar).map((f) => f.status),
    ["Extracted", "Extracted", "Extracted", "Extracted", "Conflict"],
  );
  const total = field(rebar, "Total (USD)");
  assert.deepEqual(
    total.evidence.map((e) => e.raw),
    ["USD 4,088.00", "$4,880.00"],
  );
});
test("unpaid balance does not conflict with invoice face value", () => {
  assert.equal(
    field(withPages("Invoice total: $150\nAmount due: $50"), "Total (USD)")
      .value,
    "$150",
  );
});
test("balance is available when it is the only invoice amount", () => {
  assert.equal(field(withPages("Amount due: $50"), "Total (USD)").value, "$50");
});
test("conflicting values on separate pages retain exact line coordinates", () => {
  const f = field(
    withPages("Header\rTotal: $25", "\n\nTotal: $27"),
    "Total (USD)",
  );
  assert.equal(f.status, "Conflict");
  assert.deepEqual(
    f.evidence.map((e) => [e.page, e.line]),
    [
      [1, 2],
      [2, 3],
    ],
  );
});
test("blank and placeholder values preserve citations and flag missing", () => {
  const f = field(withPages("Vendor: N/A\nVendor: "), "Supplier");
  assert.equal(f.status, "Missing");
  assert.equal(f.evidence.length, 2);
});
test("blank copy cannot hide a populated field", () => {
  assert.equal(
    field(withPages("Vendor: N/A\nVendor: Summit Steel"), "Supplier").value,
    "Summit Steel",
  );
});
test("zero tax is extracted", () => {
  const r = { ...withPages("Tax: 0.00"), kind: "Receipt" };
  assert.equal(field(r, "Tax (USD)").status, "Extracted");
});
test("accounting credits and signed credits compare equally", () => {
  const f = field(
    withPages("Total: ($1,250.00)\nInvoice total: -USD 1250"),
    "Total (USD)",
  );
  assert.equal(f.status, "Extracted");
  assert.equal(f.evidence[0].value, "-1250.00");
});
test("locale-ambiguous separators and unsupported currency remain reviewable", () => {
  for (const text of ["1.234,56", "EUR 20.00", "$1,0", "$5.000"])
    assert.equal(
      field(withPages("Total: " + text), "Total (USD)").status,
      "Check format",
    );
});
test("money comparison retains cents beyond floating point precision", () => {
  assert.equal(
    field(
      withPages("Total: 9007199254740992.01\nTotal: 9007199254740992.02"),
      "Total (USD)",
    ).status,
    "Conflict",
  );
});
test("similar identifiers on unrelated records do not create a queue conflict", () => {
  const records = ["PO-01", "PO-1"].map((n, i) => ({
    ...withPages("PO #: " + n),
    id: String(i),
  }));
  assert.equal(
    reviewQueue(records).filter((e) => e.field.issue === "Conflict").length,
    0,
  );
});
test("reviewed conflicts retain their original cause and evidence", () => {
  const [row] = reviewQueue([resolve(rebar, "Total (USD)", "$4088")]);
  assert.equal(row.field.status, "Reviewed");
  assert.equal(row.field.issue, "Conflict");
  assert.equal(row.field.evidence.length, 2);
});

const changeOrder = require("./fixtures/packet.json").find(
  (r) => r.kind === "Change order",
);
const reviseDoc = (text) => ({
  ...changeOrder,
  docs: [{ name: "change.txt", pages: [{ method: "Text", text }] }],
});
test("wrong revised sum cites each operand and the printed amount", () => {
  const [f] = review(changeOrder).filter(flagged);
  assert.equal(f.issue, "Amount mismatch");
  assert.equal(f.checks[0].expected, "237500.00");
  assert.deepEqual(
    f.checks[0].inputs.map((e) => [e.value, e.line]),
    [
      ["250000.00", 3],
      ["-12500.00", 4],
      ["262500.00", 5],
    ],
  );
});
test("missing or ambiguous operands suppress arithmetic warnings", () => {
  for (const prior of [
    "",
    "Prior contract: unclear",
    "Prior contract: 50\nPrior contract: 70",
  ]) {
    const r = reviseDoc(prior + "\nChange amount: 5\nRevised contract: 90");
    assert.equal(review(r).at(-1).issue, null);
  }
});
test("never combine distinct source documents into one equation", () => {
  const r = reviseDoc("Prior contract: 50");
  const next = attach(r, {
    name: "office",
    pages: [{ text: "Net change: 5\nRevised contract: 90", method: "Text" }],
  });
  assert.equal(review(next).at(-1).issue, null);
});
test("exact signed cents and balanced deductions", () => {
  for (const [change, total] of [
    ["Deduction: 1.10", "0.00"],
    ["Credit: (1.20)", "-0.10"],
    ["Net change: +0.01", "1.11"],
  ]) {
    const r = reviseDoc(
      "Prior contract: 1.10\n" + change + "\nRevised contract: " + total,
    );
    assert.equal(review(r).at(-1).issue, null);
  }
});
test("reviewed mismatch preserves original source math", () => {
  const r = resolve(changeOrder, "Revised contract (USD)", "237500.00");
  const f = review(r).at(-1);
  assert.equal(f.status, "Reviewed");
  assert.equal(f.checks[0].inputs[2].raw, "$262,500.00");
});
test("OCR disagreement with digital text on the same page carries distinct provenance", () => {
  const pages = [
    {
      text: "Total: $1,004.00\nTotal: $1,040.00",
      method: "PDF text + OCR",
      lineMethods: ["PDF text", "OCR"],
    },
  ];
  const f = review({ ...invoice, docs: [{ name: "mixed.pdf", pages }] }).at(-1);
  assert.equal(f.issue, "Conflict");
  assert.deepEqual(
    f.evidence.map((e) => [e.page, e.line, e.method]),
    [
      [1, 1, "PDF text"],
      [1, 2, "OCR"],
    ],
  );
});
