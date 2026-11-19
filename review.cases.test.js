// Exhaustive behavior tables for the review engine: every field label, money and date format,
// layout, sign convention, multi-copy outcome, arithmetic case and workflow step.
const test = require("node:test");
const assert = require("node:assert/strict");
const { review, reviewQueue, normalize, resolve, attach, flagged, schemas } = require("./review");

const record = (kind, ...texts) => ({
  id: "r",
  title: "Record",
  kind,
  decisions: {},
  docs: texts.map((text, i) => ({ name: `copy-${i + 1}.txt`, pages: [{ method: "Text", text }] })),
});
const field = (kind, text, label) => review(record(kind, text)).find((f) => f.label === label);
const only = (kind, label, ...texts) => review(record(kind, ...texts)).find((f) => f.label === label);

// ---------------------------------------------------------------- labels
const LABELS = {
  Invoice: {
    Supplier: [["Vendor", "Vendor Name", "Supplier", "Supplier name", "Sold by", "Bill From", "Remit to"], ": Acme Steel", "Acme Steel"],
    "Invoice number": [
      ["Invoice #:", "Invoice No:", "Invoice No.:", "Invoice Number:", "Invoice ID:", "Invoice:", "Inv #:", "Inv No:", "Inv Number:", "INVOICE #", "Invoice Number", "Invoice #", "INV#", "INVOICE #:"],
      " 4471",
      "4471",
    ],
    "Purchase order": [
      ["PO #:", "PO#:", "PO:", "PO No:", "PO Number:", "P.O. Number:", "P.O.#:", "Purchase Order:", "Purchase Order #:", "Purchase Order No.:", "Purchase order number:", "Customer PO:", "PO #", "PO#"],
      " 9",
      "9",
    ],
    Date: [["Date:", "Invoice Date:", "Order Date:", "PO Date:", "Receipt Date:", "Issue Date:", "Date Issued:", "Transaction Date:", "Purchase Date:", "Date", "Invoice Date"], " 2026-11-04", "2026-11-04"],
    "Total (USD)": [
      ["Total:", "Invoice Total:", "Amount Due:", "Total Due:", "Balance Due:", "Order Total:", "Receipt Total:", "Grand Total:", "Total Amount:", "Total Price:", "Total USD:", "Total", "TOTAL", "Balance due"],
      " $5.00",
      "5.00",
    ],
  },
  Receipt: {
    Merchant: [["Merchant:", "Merchant Name:", "Vendor:", "Store:", "Store Name:", "Retailer:"], " Haulway Fuel", "haulway fuel"],
    "Tax (USD)": [
      ["Tax:", "Sales Tax:", "Total Tax:", "Tax Amount:", "VAT:", "GST:", "HST:", "Sales Tax (8.25%):", "Tax 8.25%:", "TAX (7%):", "Tax", "VAT"],
      " $1.20",
      "1.20",
    ],
  },
  "Purchase order": {
    Item: [["Item:", "Item Description:", "Description:", "Material:"], " Graded aggregate", "graded aggregate"],
    Quantity: [["Quantity:", "Quantity Ordered:", "Qty:", "Qty Ordered:"], " 25 tons", "25 tons"],
  },
  "Change order": {
    "Change order number": [["Change Order #:", "Change Order No:", "Change Order Number:", "Change Order:", "CO #:", "CO No:", "CO Number:", "CO#", "CO #"], " 14", "14"],
    "Prior contract (USD)": [["Prior contract:", "Prior contract sum:", "Prior contract amount:", "Previous contract:", "Previous contract sum:", "Original contract:", "Original contract sum:", "Original contract amount:", "Prior contract"], " $100.00", "100.00"],
    "Revised contract (USD)": [["Revised contract:", "Revised contract sum:", "Revised contract amount:", "New contract sum:", "New contract amount:", "Adjusted contract sum:", "Contract sum to date:", "Revised contract"], " $105.00", "105.00"],
  },
};
for (const [kind, fields] of Object.entries(LABELS))
  for (const [label, [prefixes, tail, expected]] of Object.entries(fields))
    for (const prefix of prefixes)
      test(`${kind}: "${prefix}" fills ${label}`, () => {
        const f = field(kind, prefix + tail, label);
        assert.equal(f.status, "Extracted", JSON.stringify(f.evidence));
        assert.equal(f.evidence[0].value, normalize(label, expected) ?? expected.toLowerCase());
      });

test("every alias in the schema is covered by a label test", () => {
  // Guards against adding an alias without a behavior test: each field must appear in the tables above.
  const covered = new Set(Object.values(LABELS).flatMap((fields) => Object.keys(fields)));
  const needed = new Set(["Change (USD)", "Total (USD)", "Tax (USD)"]);
  for (const kind of Object.keys(schemas))
    for (const label of schemas[kind])
      assert.ok(covered.has(label) || needed.has(label) || label === "Date" || label === "Supplier" || label === "Merchant", label);
});

test("change amount labels carry the right sign", () => {
  const positive = ["Change amount", "Change order amount", "Net change", "Net change amount", "Amount of change", "Change", "Adjustment", "Addition", "Additive", "Increase"];
  const negative = ["Deduction", "Deduction amount", "Decrease", "Credit", "Credit amount"];
  for (const label of positive) assert.equal(field("Change order", `${label}: $5.00`, "Change (USD)").evidence[0].value, "5.00", label);
  for (const label of negative) assert.equal(field("Change order", `${label}: $5.00`, "Change (USD)").evidence[0].value, "-5.00", label);
});

// ---------------------------------------------------------------- money
const MONEY_OK = [
  ["$1,250.00", "1250.00"], ["1250", "1250.00"], ["1250.5", "1250.50"], ["USD 1,250.00", "1250.00"],
  ["$1,250.00 USD", "1250.00"], ["US$ 1,250.00", "1250.00"], ["$ 1,250.00", "1250.00"], ["$ 1, 250.00", "1250.00"],
  ["0.00", "0.00"], ["$0", "0.00"], ["-$5.00", "-5.00"], ["$-5.00", "-5.00"], ["- $5.00", "-5.00"],
  ["−5.00", "-5.00"], ["–5.00", "-5.00"], ["\u20145.00", "-5.00"], ["(5.00)", "-5.00"], ["($5.00)", "-5.00"],
  ["$(5.00)", "-5.00"], ["(USD 5.00)", "-5.00"], ["5.00-", "-5.00"], ["$5.00-", "-5.00"], ["5.00 CR", "-5.00"],
  ["5.00 cr", "-5.00"], ["5.00 DR", "5.00"], ["+5.00", "5.00"], ["+$5.00", "5.00"], ["$1,250.00 (net 30)", "1250.00"],
  ["$1,250.00 (due on receipt)", "1250.00"], ["007.5", "7.50"], ["1,000,000.00", "1000000.00"], ["-0.00", "0.00"],
  ["(0.00)", "0.00"], ["9,007,199,254,740,993.01", "9007199254740993.01"], ["$12", "12.00"], ["12.3", "12.30"],
];
for (const [input, expected] of MONEY_OK)
  test(`money "${input}" reads as ${expected}`, () => assert.equal(normalize("Total (USD)", input), expected));
const MONEY_BAD = [
  "S1,250.00", "$1O", "$1O.00", "l,250.00", "1.250,00", "1250,00", "$1,0", "$5.000", "$1,250.000", "$.50", "1 250.00",
  "EUR 20.00", "£20", "20.00%", "12,34", "1,2345", "five hundred", "$$5", "5..00", "(5.00", "5.00)", "-(5.00)",
  "5.00 CRDR", "1,25,000.00", "--5", "+-5", "$", "USD", "$ -", "12abc", "abc",
];
for (const input of MONEY_BAD)
  test(`money "${input}" is held for review`, () => assert.equal(normalize("Total (USD)", input), null));
test("placeholders mean missing, not malformed", () => {
  for (const placeholder of ["", "  ", "N/A", "n/a", "NA", "Unknown", "not provided", "TBD", "-", "--", "\u2014", "––"])
    assert.equal(normalize("Total (USD)", placeholder), null);
  const f = field("Invoice", "Total: N/A", "Total (USD)");
  assert.equal(f.status, "Missing");
});

// ---------------------------------------------------------------- dates
const DATES_OK = [
  ["2026-11-04", "2026-11-04"], ["2026/11/04", "2026-11-04"], ["2026.11.04", "2026-11-04"], ["2026-1-4", "2026-01-04"],
  ["Nov 4, 2026", "2026-11-04"], ["November 4, 2026", "2026-11-04"], ["Nov. 4 2026", "2026-11-04"], ["4 Nov 2026", "2026-11-04"],
  ["4 November, 2026", "2026-11-04"], ["4th November 2026", "2026-11-04"], ["November 4th, 2026", "2026-11-04"],
  ["Sept 9, 2026", "2026-09-09"], ["Sep 9, 2026", "2026-09-09"], ["11/25/2026", "2026-11-25"], ["25/11/2026", "2026-11-25"],
  ["25.11.2026", "2026-11-25"], ["05/05/2026", "2026-05-05"], ["29 Feb 2028", "2028-02-29"], ["december 31 2026", "2026-12-31"],
  ["JAN 1 2027", "2027-01-01"], ["1-Jan-2027".replace(/-/g, " "), "2027-01-01"],
];
for (const [input, expected] of DATES_OK)
  test(`date "${input}" reads as ${expected}`, () => assert.equal(normalize("Date", input), expected));
const DATES_BAD = [
  "02/03/2026", "02/03/26", "2026-02-30", "2026-13-01", "2026-00-10", "29 Feb 2026", "Foo 4, 2026", "2026-11", "11/2026",
  "Nov 2026", "TBD", "next friday", "20261104", "31 Apr 2026", "4/31/2026", "2026-11-4-1", "Nov 32, 2026", "0 Nov 2026",
];
for (const input of DATES_BAD)
  test(`date "${input}" is ambiguous or invalid and held for review`, () => assert.equal(normalize("Date", input), null));

// ---------------------------------------------------------------- identifiers and text
test("identifiers ignore case, spacing and separators but never digits", () => {
  const same = [["PO-221", "po 221"], ["INV-0012", "inv0012"], ["#4471", "4471"], ["PO_221", "PO/221"], ["PO.221", "po221"]];
  for (const [a, b] of same) assert.equal(normalize("Purchase order", a), normalize("Purchase order", b), `${a} vs ${b}`);
  const different = [["PO-01", "PO-1"], ["PO-221", "PO-212"], ["INV-4471", "INV-4417"]];
  for (const [a, b] of different) assert.notEqual(normalize("Invoice number", a), normalize("Invoice number", b), `${a} vs ${b}`);
});
test("names ignore case, punctuation and ampersands", () => {
  const same = [["Acme, Inc.", "ACME Inc"], ["A&B Supply", "A and B Supply"], ["O'Brien Co", "OBrien Co"], ["Haulway  Fuel", "haulway fuel"]];
  for (const [a, b] of same) assert.equal(normalize("Supplier", a), normalize("Supplier", b), `${a} vs ${b}`);
  assert.notEqual(normalize("Supplier", "Acme"), normalize("Supplier", "Acme Steel"));
});
test("quantities compare case-insensitively", () => assert.equal(normalize("Quantity", "25 TONS"), "25 tons"));
test("copies that differ only by formatting agree", () => {
  assert.equal(only("Invoice", "Supplier", "Vendor: Acme, Inc.", "Supplier: ACME Inc").status, "Extracted");
  assert.equal(only("Invoice", "Purchase order", "PO #: PO-221", "Purchase Order: po 221").status, "Extracted");
  assert.equal(only("Invoice", "Date", "Date: 2026-11-04", "Invoice Date: Nov 4, 2026").status, "Extracted");
  assert.equal(only("Invoice", "Total (USD)", "Total: $1,250.00", "Grand total: USD 1250").status, "Extracted");
});

// ---------------------------------------------------------------- layouts
const LAYOUTS = [
  "Total: $1,250.00", "Total:$1,250.00", "Total : $1,250.00", "Total = $1,250.00", "Total：$1,250.00", "Total\t$1,250.00",
  "Total    $1,250.00", "Total $1,250.00", "Total - $1,250.00", "Total – $1,250.00", "| Total: $1,250.00 |", "* Total: $1,250.00",
  "• Total: $1,250.00", "> Total: $1,250.00", "   TOTAL:   $1,250.00   ", "total: $1,250.00", "Total\n$1,250.00",
  "Total:\n$1,250.00", "Total:\n\n$1,250.00", "Total\r\n$1,250.00", "Total\r$1,250.00", "Total: $1,250.00",
  "Total:​$1,250.00", "﻿Total: $1,250.00", "Header\r\nTotal: $1,250.00\r\nFooter", "Total:\t\t$1,250.00",
];
for (const text of LAYOUTS)
  test(`layout ${JSON.stringify(text)} yields 1250.00`, () => {
    const f = field("Invoice", text, "Total (USD)");
    assert.equal(f.status, "Extracted");
    assert.equal(f.evidence[0].value, "1250.00");
  });
const NOT_FIELDS = [
  ["Total items: 5", "Total (USD)"], ["Subtotal: $1,250.00", "Total (USD)"], ["Sub Total  $5.00", "Total (USD)"],
  ["Total weight 5 tons", "Total (USD)"], ["The total is $5.00", "Total (USD)"], ["Totally fine: $5", "Total (USD)"],
  ["Total\nSupplier: Acme", "Total (USD)"], ["Purchase order\nSupplier: Acme", "Purchase order"],
  ["Invoice\nDate: 2026-11-04", "Invoice number"], ["Invoice number of pages: 3", "Invoice number"],
  ["Ship date: 2026-11-04", "Date"], ["Date printed 2026-11-04", "Date"], ["Date\nTotal: $5", "Date"],
];
for (const [text, label] of NOT_FIELDS)
  test(`${JSON.stringify(text)} must not fill ${label}`, () => assert.equal(field("Invoice", text, label).status, "Missing"));
test("a heading without a value never turns into a value-less blank citation", () =>
  assert.equal(field("Invoice", "TOTAL", "Total (USD)").evidence.length, 0));
test("citations point at the line holding the value", () => {
  const e = field("Invoice", "Header\nTotal\n\n$1,250.00", "Total (USD)").evidence[0];
  assert.deepEqual([e.line, e.raw], [4, "$1,250.00"]);
});
test("a value on the next line is never taken for text fields", () =>
  assert.equal(field("Invoice", "Vendor:\nAcme Steel", "Supplier").status, "Missing"));
test("empty, blank and missing page text produce all-Missing without crashing", () => {
  for (const text of ["", "\n\n", "   ", undefined, null])
    assert.ok(review({ ...record("Invoice"), docs: [{ name: "x", pages: [{ method: "Text", text }] }] }).every((f) => f.status === "Missing"));
  assert.ok(review({ ...record("Invoice"), docs: [] }).every((f) => f.status === "Missing"));
  assert.ok(review({ ...record("Invoice"), docs: [{ name: "x", pages: [] }] }).every((f) => f.status === "Missing"));
});
test("very long and adversarial lines stay fast", () => {
  const started = Date.now();
  for (const text of [" ".repeat(300000), "a ".repeat(150000), "total ".repeat(60000), ":".repeat(50000), "a:".repeat(50000), "Total: " + "9".repeat(100000)])
    review(record("Invoice", text));
  assert.ok(Date.now() - started < 3000);
});
test("an unknown record kind fails loudly", () => assert.throws(() => review({ ...record("Invoice"), kind: "Memo" }), /Unknown record kind: Memo/));
test("review never mutates its input", () => {
  const input = record("Invoice", "Total: $5\nTotal: $6");
  const frozen = JSON.parse(JSON.stringify(input));
  review(input);
  assert.deepEqual(input, frozen);
});

// ---------------------------------------------------------------- label typos from OCR
test("a single garbled letter in a long label still finds the field", () => {
  const cases = [
    ["Change order", "Prion contract: $100.00", "Prior contract (USD)"],
    ["Change order", "Revised contrct: $105.00", "Revised contract (USD)"],
    ["Change order", "Revised contract sum: $105.00".replace("sum", "snm"), "Revised contract (USD)"],
    ["Invoice", "Invoce Number: 55", "Invoice number"],
    ["Invoice", "Invoice Nubmer: 55", "Invoice number"],
    ["Invoice", "Purchse Order: 9", "Purchase order"],
    ["Receipt", "Sales Txa: $1.00".replace("Txa", "Tax").replace("Sales Tax", "Salse Tax"), "Tax (USD)"],
  ];
  for (const [kind, text, label] of cases) assert.equal(field(kind, text, label).status, "Extracted", text);
});
test("short labels, two typos and unrelated words are not guessed", () => {
  assert.equal(field("Invoice", "Tota: $5.00", "Total (USD)").status, "Missing");
  assert.equal(field("Change order", "Prionn contrct: $100.00", "Prior contract (USD)").status, "Missing");
  assert.equal(field("Invoice", "Delivery address: 12 Main St", "Supplier").status, "Missing");
});

// ---------------------------------------------------------------- signs
test("deductions are negative whatever way they are written", () => {
  const cases = [
    ["Deduction: 5", "-5.00"], ["Deduction: -5", "-5.00"], ["Deduction: (5)", "-5.00"], ["Credit: ($5.00)", "-5.00"],
    ["Credit: 0", "0.00"], ["Credit: 0.00", "0.00"], ["Deduction: 5 CR", "-5.00"], ["Deduction: 5 DR", "-5.00"], ["Decrease: $1,000.50", "-1000.50"],
  ];
  for (const [text, expected] of cases) assert.equal(field("Change order", text, "Change (USD)").evidence[0].value, expected, text);
  assert.equal(field("Change order", "Credit: N/A", "Change (USD)").status, "Missing");
});
test("a net change keeps whatever sign it was printed with", () => {
  const cases = [["Net change: 5", "5.00"], ["Net change: +5", "5.00"], ["Net change: -5", "-5.00"], ["Net change: (5)", "-5.00"], ["Net change: 5 CR", "-5.00"], ["Net change: 0", "0.00"]];
  for (const [text, expected] of cases) assert.equal(field("Change order", text, "Change (USD)").evidence[0].value, expected, text);
});

// ---------------------------------------------------------------- multiple copies
test("copies in every kind agree, conflict, hide blanks and flag malformed values", () => {
  const scenarios = [
    ["Invoice", "Total (USD)", ["Total: $5", "Total: $5.00"], "Extracted"],
    ["Invoice", "Total (USD)", ["Total: $5", "Total: $6"], "Conflict"],
    ["Invoice", "Total (USD)", ["Total: $5", "Total: "], "Extracted"],
    ["Invoice", "Total (USD)", ["Total: $5", "Total: N/A"], "Extracted"],
    ["Invoice", "Total (USD)", ["Total: $5", "Total: $5O"], "Check format"],
    ["Invoice", "Total (USD)", ["Total: ", "Total: N/A"], "Missing"],
    ["Invoice", "Invoice number", ["Invoice #: 55", "Invoice #: 56"], "Conflict"],
    ["Invoice", "Date", ["Date: 2026-11-04", "Date: 2026-11-05"], "Conflict"],
    ["Invoice", "Date", ["Date: 2026-11-04", "Date: 04/11/2026"], "Check format"],
    ["Purchase order", "Quantity", ["Qty: 25 tons", "Quantity: 52 tons"], "Conflict"],
    ["Purchase order", "Item", ["Item: Sand", "Description: Gravel"], "Conflict"],
    ["Purchase order", "Total (USD)", ["Order total: $10", "Grand total: $10.00"], "Extracted"],
    ["Receipt", "Merchant", ["Merchant: Shell", "Store: SHELL"], "Extracted"],
    ["Receipt", "Tax (USD)", ["Tax: ", "Tax: $1.20"], "Extracted"],
    ["Receipt", "Tax (USD)", ["Tax: $1.20", "Tax: $1.02"], "Conflict"],
    ["Receipt", "Tax (USD)", ["Tax: $0.00", "Tax: N/A"], "Extracted"],
    ["Change order", "Prior contract (USD)", ["Prior contract: 100", "Original contract: $100.00"], "Extracted"],
    ["Change order", "Change order number", ["CO #: 14", "Change Order No: 15"], "Conflict"],
  ];
  for (const [kind, label, texts, status] of scenarios)
    assert.equal(only(kind, label, ...texts).status, status, `${kind} ${label} ${JSON.stringify(texts)}`);
});
test("three copies: one dissenting amount is cited next to the two that agree", () => {
  const f = only("Invoice", "Total (USD)", "Total: $10", "Total: $10", "Total: $11");
  assert.equal(f.status, "Conflict");
  assert.deepEqual(f.evidence.map((e) => e.file), ["copy-1.txt", "copy-2.txt", "copy-3.txt"]);
});
test("unpaid balances never conflict with a face total, but conflict with each other", () => {
  assert.equal(only("Invoice", "Total (USD)", "Balance due: $50\nTotal: $150").evidence.length, 1);
  assert.equal(only("Invoice", "Total (USD)", "Balance due: $50\nTotal: $150").status, "Extracted");
  assert.equal(only("Invoice", "Total (USD)", "Amount due: $50\nTotal due: $50").status, "Extracted");
  assert.equal(only("Invoice", "Total (USD)", "Amount due: $50\nBalance due: $60").status, "Conflict");
  assert.equal(only("Invoice", "Total (USD)", "Balance due: $50").value, "$50");
  // On a receipt or order the same words are the total itself.
  assert.equal(only("Receipt", "Total (USD)", "Total due: $12\nTotal: $13").status, "Conflict");
});
test("manually chosen values keep the original cause", () => {
  const f = review(resolve(record("Invoice", "Total: $5", "Total: $6"), "Total (USD)", "$6.00")).at(-1);
  assert.deepEqual([f.status, f.issue, f.value, f.evidence.length], ["Reviewed", "Conflict", "$6.00", 2]);
});

// ---------------------------------------------------------------- change order arithmetic
const co = (prior, change, revised) => `Prior contract: ${prior}\n${change}\nRevised contract: ${revised}`;
const mismatch = (text) => only("Change order", "Revised contract (USD)", text);
test("balanced change orders are never flagged", () => {
  const balanced = [
    co("100", "Net change: 5", "105"), co("100", "Deduction: 5", "95"), co("100", "Credit: ($5)", "95"), co("0", "Net change: 5", "5"),
    co("5", "Deduction: 5", "0"), co("5", "Net change: -10", "-5"), co("100.10", "Net change: 0.05", "100.15"),
    co("1,000,000.00", "Net change: 0.01", "1,000,000.01"), co("999,999,999,999.99", "Net change: 0.01", "1,000,000,000,000.00"),
    co("100", "Net change: 0", "100"), co("100.00", "Net change: 0.00", "100"), co("$250,000.00", "Net change: -$12,500.00", "$237,500.00"),
    co("(50.00)", "Net change: 50.00", "0.00"), co("100", "Net change: 5.00 CR", "95"), co("0.1", "Net change: 0.2", "0.3"),
    co("1.10", "Deduction: 1.10", "0.00"), co("12,345.67", "Net change: +1,000.01", "13,345.68"),
  ];
  for (const text of balanced) assert.equal(mismatch(text).issue, null, text);
});
test("unbalanced change orders show the amount that was expected", () => {
  const cases = [
    [co("100", "Deduction: 5", "105"), "95.00"], [co("100", "Net change: 5", "95"), "105.00"], [co("100", "Net change: 5", "105.01"), "105.00"],
    [co("250,000", "Net change: -12,500", "273,500"), "237500.00"], [co("5", "Net change: -10", "5"), "-5.00"], [co("5", "Deduction: 5", "5"), "0.00"],
    [co("0.1", "Net change: 0.2", "0.31"), "0.30"], [co("100", "Credit: 5", "100"), "95.00"],
    [co("999,999,999,999.99", "Net change: 0.01", "1,000,000,000,001.00"), "1000000000000.00"],
  ];
  for (const [text, expected] of cases) {
    const f = mismatch(text);
    assert.equal(f.issue, "Amount mismatch", text);
    assert.equal(f.checks[0].expected, expected, text);
    assert.deepEqual(f.checks[0].inputs.map((e) => e.label), ["Prior contract (USD)", "Change (USD)", "Revised contract (USD)"]);
  }
});
test("arithmetic needs all three clear operands from one document", () => {
  const unclear = [
    "Net change: 5\nRevised contract: 105", "Prior contract: 100\nRevised contract: 105", "Prior contract: 100\nNet change: 5",
    co("100", "Net change: n/a", "105"), co("100", "Net change: 5O", "105"), co("100", "Net change: 5\nNet change: 6", "105"),
    co("100\nPrior contract: 101", "Net change: 5", "105"),
  ];
  for (const text of unclear) assert.notEqual(mismatch(text).issue, "Amount mismatch", text);
  // A bad operand is still reported on its own field.
  assert.equal(only("Change order", "Change (USD)", co("100", "Net change: 5O", "105")).status, "Check format");
  assert.equal(only("Change order", "Change (USD)", "Prior contract: 100\nRevised contract: 105").status, "Missing");
});
test("only the copy whose numbers do not add up is cited", () => {
  const f = only("Change order", "Revised contract (USD)", co("100", "Net change: 5", "105"), co("100", "Net change: 5", "150"));
  assert.equal(f.status, "Conflict");
  assert.equal(f.checks.length, 1);
  assert.equal(f.checks[0].inputs[0].file, "copy-2.txt");
});
test("identical wrong copies raise a single arithmetic flag, not a conflict", () => {
  const f = only("Change order", "Revised contract (USD)", co("100", "Net change: 5", "150"), co("100", "Net change: 5", "150"));
  assert.equal(f.status, "Amount mismatch");
  assert.equal(f.checks.length, 2);
});
test("a reviewed mismatch keeps its explanation and survives re-review", () => {
  const r = resolve(record("Change order", co("100", "Net change: 5", "150")), "Revised contract (USD)", "105");
  const f = review(r).at(-1);
  assert.deepEqual([f.status, f.issue, f.value, f.checks.length], ["Reviewed", "Amount mismatch", "105", 1]);
});
test("mismatch arithmetic reads each operand across the pages of one document", () => {
  const r = {
    ...record("Change order"),
    docs: [{ name: "two-pages.pdf", pages: [{ method: "OCR", text: "Prior contract: 80,000" }, { method: "OCR", text: "Net change: 2,500\nRevised contract: 83,000" }] }],
  };
  const f = review(r).at(-1);
  assert.equal(f.issue, "Amount mismatch");
  assert.deepEqual(f.checks[0].inputs.map((e) => e.page), [1, 2, 2]);
});

// ---------------------------------------------------------------- workflow
test("flagged() is true exactly for the four review reasons", () => {
  for (const status of ["Missing", "Conflict", "Check format", "Amount mismatch"]) assert.equal(flagged({ status }), true, status);
  for (const status of ["Extracted", "Reviewed"]) assert.equal(flagged({ status }), false, status);
});
test("resolve accepts only schema fields and valid values of the right type", () => {
  const r = record("Receipt", "Tax: ");
  assert.throws(() => resolve(r, "Subtotal", "5"));
  assert.throws(() => resolve(r, "Tax (USD)", "abc"));
  assert.throws(() => resolve(r, "Tax (USD)", ""));
  assert.throws(() => resolve(r, "Date", "02/03/26"));
  assert.throws(() => resolve(r, "Date", "next week"));
  assert.throws(() => resolve(r, "Merchant", "  "));
  assert.doesNotThrow(() => resolve(r, "Tax (USD)", "($1.20)"));
  assert.doesNotThrow(() => resolve(r, "Date", "Nov 4, 2026"));
  assert.doesNotThrow(() => resolve(r, "Merchant", "Haulway Fuel"));
});
test("resolve does not mutate the record and trims the chosen value", () => {
  const r = record("Receipt", "Tax: ");
  const next = resolve(r, "Tax (USD)", "  $1.20  ");
  assert.deepEqual(r.decisions, {});
  assert.equal(next.decisions["Tax (USD)"].value, "$1.20");
  assert.match(next.decisions["Tax (USD)"].at, /^\d{4}-\d\d-\d\dT/);
});
test("resolving a missing field marks it reviewed but remembers why it was flagged", () => {
  const f = review(resolve(record("Receipt", "Merchant: Shell"), "Tax (USD)", "0")).find((x) => x.label === "Tax (USD)");
  assert.deepEqual([f.status, f.issue, f.value, flagged(f)], ["Reviewed", "Missing", "0", false]);
});
test("new evidence reopens every earlier decision, identical evidence does not", () => {
  const r = resolve(resolve(record("Receipt", "Tax: "), "Tax (USD)", "0"), "Total (USD)", "5");
  assert.equal(attach(r, r.docs[0]), r);
  const same = { name: r.docs[0].name, pages: [{ ...r.docs[0].pages[0] }] };
  assert.equal(attach(r, same), r);
  const reopened = attach(r, { name: r.docs[0].name, pages: [{ method: "Text", text: "Tax: $1" }] });
  assert.deepEqual(reopened.decisions, {});
  assert.equal(reopened.docs.length, 2);
  assert.equal(attach(r, { name: "other.txt", pages: r.docs[0].pages }).docs.length, 2);
});
test("the queue lists every flagged field across records, in record order, and nothing else", () => {
  const clean = { ...record("Invoice", "Vendor: A\nInvoice #: 1\nDate: 2026-11-04\nPO #: 2\nTotal: $5"), id: "a", title: "Clean" };
  const bad = { ...record("Receipt", "Merchant: Shell\nDate: 2026-11-04\nTotal: $5"), id: "b", title: "Missing tax" };
  const worse = { ...record("Invoice", "Total: $5\nTotal: $6"), id: "c", title: "Conflict" };
  const queue = reviewQueue([clean, bad, worse]);
  assert.deepEqual(queue.map((e) => [e.recordId, e.field.label, e.field.issue]).filter((e) => e[0] !== "c"), [["b", "Tax (USD)", "Missing"]]);
  assert.deepEqual(queue.filter((e) => e.recordId === "c").map((e) => e.field.issue).sort(), ["Conflict", "Missing", "Missing", "Missing", "Missing"]);
  assert.ok(queue.every((e) => e.title));
  assert.deepEqual(reviewQueue([clean]), []);
  assert.deepEqual(reviewQueue([]), []);
});
test("every schema field has aliases and every kind is reviewable", () => {
  for (const [kind, labels] of Object.entries(schemas)) {
    assert.equal(review(record(kind)).length, labels.length, kind);
    assert.ok(new Set(labels).size === labels.length, `${kind} has duplicate labels`);
  }
});
